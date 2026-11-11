/**
 * Array-Backed Binary Min-Heap Implementation.
 *
 * Implements a high-performance priority queue using contiguous array indexing math:
 * - Parent: Math.floor((i - 1) / 2)
 * - Left Child: 2 * i + 1
 * - Right Child: 2 * i + 2
 *
 * Designed for Top-K extraction: maintaining a Min-Heap of size K bounds memory
 * to O(K) and execution to O(N log K) across N incoming stream candidates.
 */

export class MinHeap {
  /**
   * @param {function(a: any, b: any): number} [comparator] - Negative if a < b, positive if a > b.
   * @param {number|null} [capacity=null] - Maximum bounded capacity.
   */
  constructor(comparator, capacity = null) {
    this.comparator = comparator || ((a, b) => {
      if (a.frequency !== b.frequency) {
        return a.frequency - b.frequency;
      }
      // Deterministic tie-breaking: reverse alphabetical for min-heap eviction
      return b.query.localeCompare(a.query);
    });
    this.capacity = capacity;
    this.heap = [];
  }

  /**
   * Returns current number of items in heap.
   * @returns {number}
   */
  size() {
    return this.heap.length;
  }

  /**
   * Checks if heap is empty.
   * @returns {boolean}
   */
  isEmpty() {
    return this.heap.length === 0;
  }

  /**
   * Inspects root element without removal in O(1) time.
   * In a Min-Heap, this is the element with the lowest frequency.
   * @returns {any|null}
   */
  peek() {
    return this.heap.length > 0 ? this.heap[0] : null;
  }

  /**
   * Inserts an item into the heap.
   * If capacity is bounded and heap is full, performs single-pass pushPop.
   * @param {any} item
   */
  insert(item) {
    if (this.capacity !== null && this.heap.length >= this.capacity) {
      if (this.comparator(item, this.heap[0]) > 0) {
        this.pushPop(item);
      }
      return;
    }

    this.heap.push(item);
    this._siftUp(this.heap.length - 1);
  }

  /**
   * Replaces root element with a new item and sifts down in O(log K) time.
   * Cuts pointer swaps by 50% compared to pop() followed by insert().
   * @param {any} item
   * @returns {any} The evicted previous root or the item if not accepted
   */
  pushPop(item) {
    if (this.heap.length === 0) {
      return item;
    }

    // If new item is smaller than root minimum, it cannot enter top-K
    if (this.comparator(item, this.heap[0]) <= 0) {
      return item;
    }

    const previousRoot = this.heap[0];
    this.heap[0] = item;
    this._siftDown(0);
    return previousRoot;
  }

  /**
   * Removes and returns the root minimum element in O(log K) time.
   * @returns {any|null}
   */
  pop() {
    if (this.heap.length === 0) {
      return null;
    }
    if (this.heap.length === 1) {
      return this.heap.pop();
    }

    const root = this.heap[0];
    this.heap[0] = this.heap.pop();
    this._siftDown(0);
    return root;
  }

  /**
   * Restores heap invariant upwards from index to root.
   * @param {number} index
   * @private
   */
  _siftUp(index) {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.comparator(this.heap[current], this.heap[parent]) < 0) {
        const temp = this.heap[current];
        this.heap[current] = this.heap[parent];
        this.heap[parent] = temp;
        current = parent;
      } else {
        break;
      }
    }
  }

  /**
   * Restores heap invariant downwards from index to leaves.
   * @param {number} index
   * @private
   */
  _siftDown(index) {
    const length = this.heap.length;
    let current = index;

    while (true) {
      const left = 2 * current + 1;
      const right = 2 * current + 2;
      let smallest = current;

      if (left < length && this.comparator(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < length && this.comparator(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }

      if (smallest !== current) {
        const temp = this.heap[current];
        this.heap[current] = this.heap[smallest];
        this.heap[smallest] = temp;
        current = smallest;
      } else {
        break;
      }
    }
  }

  /**
   * Returns suggestions sorted descending by frequency for direct autocomplete rendering.
   * @returns {Array<any>}
   */
  getSortedValues() {
    return [...this.heap].sort((a, b) => {
      if (b.frequency !== a.frequency) {
        return b.frequency - a.frequency;
      }
      return a.query.localeCompare(b.query);
    });
  }
}
