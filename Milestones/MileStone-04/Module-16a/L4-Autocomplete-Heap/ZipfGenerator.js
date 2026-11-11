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
 */

export class ZipfGenerator {
  /**
   * @param {Array<any>} items - Ordered list of items (rank 1 is index 0).
   * @param {number} [s=1.0] - Skew parameter (s > 0). Higher s creates steeper head concentration.
   */
  constructor(items, s = 1.0) {
    if (!items || items.length === 0) {
      throw new Error("ZipfGenerator requires a non-empty array of items.");
    }
    this.items = items;
    this.s = s;
    this.n = items.length;
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
  sample() {
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

    return this.items[selectedIndex];
  }

  /**
   * Generates a batch of N samples.
   * @param {number} count
   * @returns {Array<any>}
   */
  sampleBatch(count) {
    const results = new Array(count);
    for (let i = 0; i < count; i++) {
      results[i] = this.sample();
    }
    return results;
  }

  /**
   * Returns theoretical probability for a 1-indexed rank.
   * @param {number} rank
   * @returns {number}
   */
  getProbability(rank) {
    if (rank < 1 || rank > this.n) return 0;
    const prev = rank === 1 ? 0 : this.cdf[rank - 2];
    return this.cdf[rank - 1] - prev;
  }
}
