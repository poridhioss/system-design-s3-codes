/**
 * RingBuffer.js - Fixed-Capacity Typed Circular Ring Buffer
 *
 * Tracks binary request outcomes (1 = SUCCESS, 0 = FAILURE) over a sliding
 * window using a contiguous Uint8Array. Eliminates dynamic JavaScript object
 * allocations and V8 garbage collection churn during high-frequency traffic.
 */

export class SlidingWindowRingBuffer {
  /**
   * @param {number} capacity - Fixed number of rolling requests to track (default: 100)
   */
  constructor(capacity = 100) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new TypeError("Capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.buffer = new Uint8Array(capacity);
    this.head = 0;
    this.totalRecorded = 0;
  }

  /**
   * Records a request outcome into the circular buffer.
   * Advances the head pointer modulo capacity.
   *
   * @param {boolean} success - True if request succeeded within SLA, false otherwise
   */
  record(success) {
    this.buffer[this.head] = success ? 1 : 0;
    this.head = (this.head + 1) % this.capacity;
    this.totalRecorded++;
  }

  /**
   * Returns the count of valid samples currently recorded in the window.
   * Caps at buffer capacity once saturated.
   *
   * @returns {number}
   */
  getCount() {
    return Math.min(this.totalRecorded, this.capacity);
  }

  /**
   * Returns the count of failed requests within the active window.
   *
   * @returns {number}
   */
  getFailureCount() {
    const activeCount = this.getCount();
    let failures = 0;
    for (let i = 0; i < activeCount; i++) {
      if (this.buffer[i] === 0) {
        failures++;
      }
    }
    return failures;
  }

  /**
   * Returns the count of successful requests within the active window.
   *
   * @returns {number}
   */
  getSuccessCount() {
    return this.getCount() - this.getFailureCount();
  }

  /**
   * Calculates the rolling failure rate as a float between 0.0 and 1.0.
   *
   * @returns {number}
   */
  getFailureRate() {
    const activeCount = this.getCount();
    if (activeCount === 0) return 0.0;
    return this.getFailureCount() / activeCount;
  }

  /**
   * Clears all recorded entries and resets head pointer and counter.
   */
  reset() {
    this.buffer.fill(0);
    this.head = 0;
    this.totalRecorded = 0;
  }
}
