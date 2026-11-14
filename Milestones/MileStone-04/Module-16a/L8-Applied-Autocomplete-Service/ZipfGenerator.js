/**
 * Synthetic Zipfian Power-Law Traffic Generator.
 *
 * Models real-world search engine query distribution where a small fraction of queries
 * (the "head") accounts for the vast majority of search volume:
 *
 *   P(r) = (1 / r^s) / sum(1 / n^s for n in 1..N)
 *
 * Uses a precomputed Cumulative Distribution Function (CDF) and binary search
 * to generate power-law traffic samples in O(log N) time.
 * Pre-populated from Lab 4.
 */

export class ZipfGenerator {
  /**
   * @param {Array<any>} items - Ordered list of items (rank 1 is index 0).
   * @param {number} [s=1.0] - Skew parameter (s > 0). Higher s creates steeper head concentration.
   */
  constructor(itemsOrCount, s = 1.0) {
    if (Array.isArray(itemsOrCount)) {
      if (itemsOrCount.length === 0) {
        throw new Error("ZipfGenerator requires a non-empty array of items.");
      }
      this.items = itemsOrCount;
      this.n = itemsOrCount.length;
    } else {
      this.items = null;
      this.n = typeof itemsOrCount === "number" ? itemsOrCount : 1000;
    }
    this.s = s;
    this.cdf = new Float64Array(this.n);

    this._computeCDF();
  }

  /**
   * Precomputes the Cumulative Distribution Function array.
   * @private
   */
  _computeCDF() {
    let sum = 0.0;
    for (let r = 1; r <= this.n; r++) {
      sum += 1.0 / Math.pow(r, this.s);
    }

    let cumulative = 0.0;
    for (let i = 0; i < this.n; i++) {
      const rank = i + 1;
      cumulative += (1.0 / Math.pow(rank, this.s)) / sum;
      this.cdf[i] = cumulative;
    }
    // Guard against floating point rounding
    this.cdf[this.n - 1] = 1.0;
  }

  /**
   * Samples a single item following the Zipfian distribution in O(log N) time.
   * @returns {any}
   */
  nextIndex() {
    const randomVal = Math.random();
    let low = 0;
    let high = this.n - 1;
    let selectedIndex = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.cdf[mid] >= randomVal) {
        selectedIndex = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return selectedIndex;
  }

  sample() {
    const selectedIndex = this.nextIndex();
    return this.items ? this.items[selectedIndex] : selectedIndex;
  }

  /**
   * Generates a batch of N samples in a single call.
   * @param {number} count
   * @returns {Array<any>}
   */
  sampleBatch(count) {
    const batch = new Array(count);
    for (let i = 0; i < count; i++) {
      batch[i] = this.sample();
    }
    return batch;
  }
}
