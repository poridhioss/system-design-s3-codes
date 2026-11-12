/**
 * CircuitBreaker.js - Production-Grade 3-State Finite State Machine Circuit Breaker
 *
 * Protects systems from cascading failures and worker pool starvation when
 * downstream databases or search clusters slow down, time out, or crash.
 * Implements the canonical 3-state lifecycle:
 *   - CLOSED: Normal operation. Primary calls flow unimpeded.
 *   - OPEN: Threshold breached. Calls fail fast in <0.001ms or hit local fallback.
 *   - HALF_OPEN: Cooldown elapsed. A single scout canary probe tests recovery.
 */

import { SlidingWindowRingBuffer } from "./RingBuffer.js";

export const CircuitState = Object.freeze({
  CLOSED: "CLOSED",
  OPEN: "OPEN",
  HALF_OPEN: "HALF_OPEN",
});

export class CircuitBreaker {
  /**
   * @param {Object} options
   * @param {number} [options.failureThreshold=0.50] - Error rate percentage to trip CLOSED -> OPEN (0.0 to 1.0)
   * @param {number} [options.minRequests=10] - Minimum samples in window before evaluating failure rate
   * @param {number} [options.recoveryTimeoutMs=3000] - Milliseconds to stay OPEN before attempting HALF_OPEN canary
   * @param {number} [options.timeoutSlaMs=500] - Request latency SLA cap before marking as timeout failure
   * @param {number} [options.ringBufferCapacity=100] - Capacity of the sliding-window typed ring buffer
   */
  constructor({
    failureThreshold = 0.50,
    minRequests = 10,
    recoveryTimeoutMs = 3000,
    timeoutSlaMs = 500,
    ringBufferCapacity = 100,
  } = {}) {
    this.failureThreshold = failureThreshold;
    this.minRequests = minRequests;
    this.recoveryTimeoutMs = recoveryTimeoutMs;
    this.timeoutSlaMs = timeoutSlaMs;

    this.state = CircuitState.CLOSED;
    this.ringBuffer = new SlidingWindowRingBuffer(ringBufferCapacity);
    this.canaryInFlight = false;
    this.lastStateChange = Date.now();
    this.lastFailureTime = null;
    this.lastError = null;
  }

  /**
   * Determines whether an incoming request may be dispatched downstream.
   *
   * @returns {boolean} True if call is permitted, false if quarantined / fast-failing
   */
  canExecute() {
    const now = Date.now();

    if (this.state === CircuitState.CLOSED) {
      return true;
    }

    if (this.state === CircuitState.OPEN) {
      const elapsed = now - (this.lastFailureTime || this.lastStateChange);
      if (elapsed >= this.recoveryTimeoutMs) {
        // Cooldown elapsed: Transition to HALF_OPEN and grant single canary probe
        this.state = CircuitState.HALF_OPEN;
        this.lastStateChange = now;
        this.canaryInFlight = true;
        return true;
      }
      return false; // Quarantine active: fast fail
    }

    if (this.state === CircuitState.HALF_OPEN) {
      // Single-flight latch: permit only 1 scout probe, divert all concurrent traffic
      if (!this.canaryInFlight) {
        this.canaryInFlight = true;
        return true;
      }
      return false;
    }

    return false;
  }

  /**
   * Records a successful primary execution within SLA.
   */
  recordSuccess() {
    this.canaryInFlight = false;

    if (this.state === CircuitState.HALF_OPEN) {
      // Canary succeeded: heal back to CLOSED and reset buffer
      this.state = CircuitState.CLOSED;
      this.lastStateChange = Date.now();
      this.ringBuffer.reset();
      this.lastError = null;
    } else if (this.state === CircuitState.CLOSED) {
      this.ringBuffer.record(true);
    }
  }

  /**
   * Records a downstream failure or latency SLA breach.
   *
   * @param {Error|string} [error="Request failed or exceeded SLA"]
   */
  recordFailure(error = "Request failed or exceeded SLA") {
    const now = Date.now();
    this.canaryInFlight = false;
    this.lastFailureTime = now;
    this.lastError = error instanceof Error ? error.message : String(error);

    if (this.state === CircuitState.HALF_OPEN) {
      // Canary scout failed: immediately abort recovery and revert to OPEN
      this.state = CircuitState.OPEN;
      this.lastStateChange = now;
    } else if (this.state === CircuitState.CLOSED) {
      this.ringBuffer.record(false);

      // Evaluate error rate if minimum sample size is met
      if (this.ringBuffer.getCount() >= this.minRequests) {
        if (this.ringBuffer.getFailureRate() >= this.failureThreshold) {
          this.state = CircuitState.OPEN;
          this.lastStateChange = now;
        }
      }
    }
  }

  /**
   * Executes a command with timeout SLA protection and optional degraded fallback.
   *
   * @param {Function} commandFn - Async function performing the downstream call
   * @param {Function} [fallbackFn=null] - Optional async fallback returning degraded results
   * @returns {Promise<any>}
   */
  async execute(commandFn, fallbackFn = null) {
    if (!this.canExecute()) {
      const fastFailError = new Error(
        `CircuitBreaker is ${this.state}: downstream service is quarantined (fast-fail)`
      );
      if (fallbackFn) {
        return await fallbackFn(fastFailError);
      }
      throw fastFailError;
    }

    let timerId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => {
        reject(new Error(`Operation exceeded timeout SLA of ${this.timeoutSlaMs}ms`));
      }, this.timeoutSlaMs);
    });

    try {
      const result = await Promise.race([commandFn(), timeoutPromise]);
      clearTimeout(timerId);
      this.recordSuccess();
      return result;
    } catch (err) {
      clearTimeout(timerId);
      this.recordFailure(err);
      if (fallbackFn) {
        return await fallbackFn(err);
      }
      throw err;
    }
  }

  /**
   * Administrative chaos trigger to manually force the circuit OPEN.
   *
   * @param {string} [reason="Manual administrative trip"]
   */
  trip(reason = "Manual administrative trip") {
    this.state = CircuitState.OPEN;
    this.canaryInFlight = false;
    this.lastFailureTime = Date.now();
    this.lastStateChange = Date.now();
    this.lastError = reason;
  }

  /**
   * Administrative reset to force the circuit CLOSED.
   */
  reset() {
    this.state = CircuitState.CLOSED;
    this.canaryInFlight = false;
    this.ringBuffer.reset();
    this.lastFailureTime = null;
    this.lastStateChange = Date.now();
    this.lastError = null;
  }

  /**
   * Returns real-time observability telemetry.
   *
   * @returns {Object}
   */
  getStatus() {
    const now = Date.now();
    let cooldownRemainingMs = 0;
    if (this.state === CircuitState.OPEN && this.lastFailureTime) {
      const elapsed = now - this.lastFailureTime;
      cooldownRemainingMs = Math.max(0, this.recoveryTimeoutMs - elapsed);
    }

    return {
      state: this.state,
      failureRate: Number(this.ringBuffer.getFailureRate().toFixed(4)),
      totalCalls: this.ringBuffer.getCount(),
      failures: this.ringBuffer.getFailureCount(),
      successes: this.ringBuffer.getSuccessCount(),
      cooldownRemainingMs,
      canaryInFlight: this.canaryInFlight,
      lastError: this.lastError,
      uptimeInStateMs: now - this.lastStateChange,
    };
  }
}
