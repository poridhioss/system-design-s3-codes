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
 * Pre-populated from Lab 4.
 */

export class MinHeap {
  /**
   * @param {function(a: any, b: any): number} [comparator] - Negative if a < b, positive if a > b.
   * @param {number|null} [capacity=null] - Maximum bounded capacity.
   */
  constructor(comparator, capacity = null) {
    this.comparator = comparator || ((a, b) => {
      const freqA = a.frequency !== undefined ? a.frequency : (a.score !== undefined ? a.score : 0);
      const freqB = b.frequency !== undefined ? b.frequency : (b.score !== undefined ? b.score : 0);
      if (freqA !== freqB) {
        return freqA - freqB;
      }
      const strA = a.query || a.word || "";
      const strB = b.query || b.word || "";
      return strB.localeCompare(strA);
    });
    this.capacity = capacity;
    this.heap = [];
  }

  size() {
    return this.heap.length;
  }

  isEmpty() {
    return this.heap.length === 0;
  }

  peek() {
    return this.heap.length > 0 ? this.heap[0] : null;
  }

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

  pushPop(item) {
    if (this.heap.length === 0) {
      return item;
    }

    if (this.comparator(item, this.heap[0]) <= 0) {
      return item;
    }

    const previousRoot = this.heap[0];
    this.heap[0] = item;
    this._siftDown(0);
    return previousRoot;
  }

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

  getSortedValues() {
    return [...this.heap].sort((a, b) => {
      const freqA = a.frequency !== undefined ? a.frequency : (a.score !== undefined ? a.score : 0);
      const freqB = b.frequency !== undefined ? b.frequency : (b.score !== undefined ? b.score : 0);
      if (freqB !== freqA) {
        return freqB - freqA;
      }
      const strA = a.query || a.word || "";
      const strB = b.query || b.word || "";
      return strA.localeCompare(strB);
    });
  }
}
