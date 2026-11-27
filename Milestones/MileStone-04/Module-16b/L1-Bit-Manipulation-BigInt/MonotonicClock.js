/**
 * MonotonicClock provides non-decreasing millisecond time readings
 * backed by hardware nanoseconds (CLOCK_MONOTONIC_RAW via process.hrtime.bigint()).
 */
export class MonotonicClock {
  constructor() {
    this.initialWallMs = BigInt(Date.now());
    this.initialHardwareNs = process.hrtime.bigint();
    this.lastEmittedMs = this.initialWallMs;
  }

  /**
   * Returns current time in milliseconds since Unix epoch,
   * guaranteeing that values are strictly non-decreasing.
   */
  nowMs() {
    const currentHardwareNs = process.hrtime.bigint();
    const elapsedNs = currentHardwareNs - this.initialHardwareNs;
    const elapsedMs = elapsedNs / 1000000n;
    const calculatedMs = this.initialWallMs + elapsedMs;

    // Keep emitted milliseconds monotonically forward
    if (calculatedMs < this.lastEmittedMs) {
      return this.lastEmittedMs;
    }

    this.lastEmittedMs = calculatedMs;
    return calculatedMs;
  }

  /**
   * Returns raw elapsed hardware nanoseconds since process boot.
   */
  nowNs() {
    return process.hrtime.bigint();
  }

  /**
   * Tight spin-wait loop that blocks execution until the millisecond tick advances.
   * Required when sequence numbers are exhausted within a single millisecond.
   */
  waitUntilNextMs(lastTimestampMs) {
    let current = this.nowMs();
    while (current <= lastTimestampMs) {
      current = this.nowMs();
    }
    return current;
  }
}
