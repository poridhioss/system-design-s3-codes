/**
 * test_circuit_breaker.js - Automated Unit Test Suite for Circuit Breaker FSM
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowRingBuffer } from "./RingBuffer.js";
import { CircuitBreaker, CircuitState } from "./CircuitBreaker.js";

describe("Suite 1: SlidingWindowRingBuffer Invariants & Modulo Wrapping", () => {
  test("initializes buffer with typed Uint8Array and exact capacity", () => {
    const rb = new SlidingWindowRingBuffer(10);
    assert.equal(rb.capacity, 10);
    assert.ok(rb.buffer instanceof Uint8Array);
    assert.equal(rb.getCount(), 0);
    assert.equal(rb.getFailureRate(), 0.0);
  });

  test("accurately records successes and failures", () => {
    const rb = new SlidingWindowRingBuffer(10);
    rb.record(true);
    rb.record(true);
    rb.record(false);
    assert.equal(rb.getCount(), 3);
    assert.equal(rb.getSuccessCount(), 2);
    assert.equal(rb.getFailureCount(), 1);
    assert.equal(Number(rb.getFailureRate().toFixed(2)), 0.33);
  });

  test("wraps head pointer modulo capacity on saturation", () => {
    const rb = new SlidingWindowRingBuffer(3);
    rb.record(true);  // [1, 0, 0] head=1, total=1
    rb.record(false); // [1, 0, 0] head=2, total=2
    rb.record(true);  // [1, 0, 1] head=0, total=3
    assert.equal(rb.getCount(), 3);
    assert.equal(rb.getFailureCount(), 1);

    // Overwrite oldest entry (slot 0 was 1, now overwritten with 0)
    rb.record(false); // [0, 0, 1] head=1, total=4
    assert.equal(rb.getCount(), 3);
    assert.equal(rb.getFailureCount(), 2);
  });

  test("resets buffer completely to initial state", () => {
    const rb = new SlidingWindowRingBuffer(5);
    rb.record(false);
    rb.record(false);
    rb.reset();
    assert.equal(rb.getCount(), 0);
    assert.equal(rb.getFailureCount(), 0);
    assert.equal(rb.getFailureRate(), 0.0);
  });
});

describe("Suite 2: Circuit Breaker FSM State Transitions & Error Rate Tripping", () => {
  test("initializes in CLOSED state allowing traffic", () => {
    const cb = new CircuitBreaker();
    assert.equal(cb.state, CircuitState.CLOSED);
    assert.equal(cb.canExecute(), true);
  });

  test("does not trip before minimum sample size is reached", () => {
    const cb = new CircuitBreaker({ minRequests: 5, failureThreshold: 0.5 });
    // 3 consecutive failures (100% rate, but count < minRequests)
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    assert.equal(cb.state, CircuitState.CLOSED);
    assert.equal(cb.canExecute(), true);
  });

  test("trips to OPEN when error rate exceeds threshold after minRequests", () => {
    const cb = new CircuitBreaker({ minRequests: 4, failureThreshold: 0.5 });
    cb.recordSuccess(); // 1
    cb.recordFailure(); // 2
    cb.recordFailure(); // 3
    cb.recordFailure(); // 4 -> 3 failures out of 4 (75% >= 50%)
    assert.equal(cb.state, CircuitState.OPEN);
    assert.equal(cb.canExecute(), false);
  });

  test("fast-fails calls immediately when OPEN in sub-microsecond time", () => {
    const cb = new CircuitBreaker();
    cb.trip("Administrative chaos test");
    assert.equal(cb.state, CircuitState.OPEN);
    assert.equal(cb.canExecute(), false);

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      cb.canExecute();
    }
    const elapsedUs = ((performance.now() - start) / 1000) * 1000;
    assert.ok(elapsedUs < 0.5, `Fast-fail took ${elapsedUs}us, expected < 0.5us`);
  });
});

describe("Suite 3: Cooldown Expiry & Single-Flight Canary Probe Latching", () => {
  test("transitions to HALF_OPEN after recovery cooldown elapses", async () => {
    const cb = new CircuitBreaker({ recoveryTimeoutMs: 50 });
    cb.trip();
    assert.equal(cb.state, CircuitState.OPEN);
    assert.equal(cb.canExecute(), false);

    await new Promise((r) => setTimeout(r, 60));

    // First call after cooldown initiates canary probe
    assert.equal(cb.canExecute(), true);
    assert.equal(cb.state, CircuitState.HALF_OPEN);
    assert.equal(cb.canaryInFlight, true);
  });

  test("blocks concurrent calls while canary probe is in flight", async () => {
    const cb = new CircuitBreaker({ recoveryTimeoutMs: 50 });
    cb.trip();
    await new Promise((r) => setTimeout(r, 60));

    // 1st request gets canary permission
    assert.equal(cb.canExecute(), true);
    assert.equal(cb.canaryInFlight, true);

    // 2nd and 3rd concurrent requests must be rejected / diverted to fallback
    assert.equal(cb.canExecute(), false);
    assert.equal(cb.canExecute(), false);
  });

  test("reverts to CLOSED when canary probe succeeds", async () => {
    const cb = new CircuitBreaker({ recoveryTimeoutMs: 50 });
    cb.trip();
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(cb.canExecute(), true);
    cb.recordSuccess();

    assert.equal(cb.state, CircuitState.CLOSED);
    assert.equal(cb.canaryInFlight, false);
    assert.equal(cb.canExecute(), true);
  });

  test("immediately re-trips to OPEN when canary probe fails", async () => {
    const cb = new CircuitBreaker({ recoveryTimeoutMs: 50 });
    cb.trip();
    await new Promise((r) => setTimeout(r, 60));

    assert.equal(cb.canExecute(), true);
    cb.recordFailure("Canary probe connection refused");

    assert.equal(cb.state, CircuitState.OPEN);
    assert.equal(cb.canaryInFlight, false);
    assert.equal(cb.canExecute(), false);
  });
});

describe("Suite 4: SLA Timeout Races & Fallback Execution", () => {
  test("executes successful downstream command within SLA", async () => {
    const cb = new CircuitBreaker({ timeoutSlaMs: 100 });
    const result = await cb.execute(async () => {
      return "search-results-payload";
    });
    assert.equal(result, "search-results-payload");
    assert.equal(cb.state, CircuitState.CLOSED);
  });

  test("times out slow commands exceeding SLA and trips breaker", async () => {
    const cb = new CircuitBreaker({
      minRequests: 1,
      failureThreshold: 0.5,
      timeoutSlaMs: 30,
    });

    await assert.rejects(
      async () => {
        await cb.execute(async () => {
          await new Promise((r) => setTimeout(r, 100)); // Stalls past 30ms SLA
          return "too-late";
        });
      },
      /exceeded timeout SLA of 30ms/
    );

    assert.equal(cb.state, CircuitState.OPEN);
  });

  test("diverts to degraded fallback when circuit is OPEN", async () => {
    const cb = new CircuitBreaker();
    cb.trip();

    const fallbackResult = await cb.execute(
      async () => "unreachable-primary",
      async (err) => ({ degraded: true, source: "in-memory-cache", error: err.message })
    );

    assert.equal(fallbackResult.degraded, true);
    assert.equal(fallbackResult.source, "in-memory-cache");
    assert.match(fallbackResult.error, /quarantined/);
  });

  test("provides complete status telemetry dictionary", () => {
    const cb = new CircuitBreaker({ failureThreshold: 0.4 });
    cb.recordSuccess();
    cb.recordFailure("downstream 503");
    const status = cb.getStatus();

    assert.equal(status.state, CircuitState.CLOSED);
    assert.equal(status.totalCalls, 2);
    assert.equal(status.failures, 1);
    assert.equal(status.successes, 1);
    assert.equal(status.failureRate, 0.5);
    assert.equal(status.lastError, "downstream 503");
  });
});
