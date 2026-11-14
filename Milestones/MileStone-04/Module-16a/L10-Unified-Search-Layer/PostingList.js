/**
 * PostingList.js
 *
 * Implements high-performance Information Retrieval posting list data structures
 * and algorithms in native Node.js 20+ ES Modules:
 * 1. SortedPostingList: Strictly monotonic Document ID sequence with Term Frequencies.
 * 2. TwoPointerIntersector: Linear O(L1 + L2) Boolean AND intersection engine with shortest-list heuristic.
 * 3. DeltaCompressor: Monotonic integer sequence to delta gap encoder and decoder.
 */

/**
 * Class representing a single monotonically sorted posting list for a specific term.
 * Guarantees strict monotonic ascending DocID ordering (D0 < D1 < D2 < ...).
 */
export class SortedPostingList {
  /**
   * @param {string} term - The normalized vocabulary term.
   */
  constructor(term) {
    this.term = term;
    /** @type {number[]} */
    this.docIds = [];
    /** @type {number[]} */
    this.termFreqs = [];
    this.totalOccurrences = 0;
  }

  /**
   * Appends or updates a posting entry.
   * Enforces strict monotonic DocID ordering (docId >= lastDocId).
   *
   * @param {number} docId - The 32-bit unsigned integer Document ID.
   * @param {number} [tf=1] - Term frequency of this word in the document.
   * @returns {SortedPostingList} this
   * @throws {Error} if docId violates monotonic ordering.
   */
  add(docId, tf = 1) {
    if (typeof docId !== "number" || docId < 0 || !Number.isInteger(docId)) {
      throw new TypeError(`Invalid docId: ${docId}. Expected non-negative integer.`);
    }

    const len = this.docIds.length;
    if (len > 0) {
      const lastDocId = this.docIds[len - 1];
      if (docId === lastDocId) {
        // Same document encountered again: increment term frequency
        this.termFreqs[len - 1] += tf;
        this.totalOccurrences += tf;
        return this;
      }
      if (docId < lastDocId) {
        throw new Error(
          `Monotonic ordering violation: Attempted to add docId ${docId} after ${lastDocId} for term "${this.term}".`
        );
      }
    }

    this.docIds.push(docId);
    this.termFreqs.push(tf);
    this.totalOccurrences += tf;
    return this;
  }

  /**
   * Returns the Document Frequency (DF) — number of unique documents containing this term.
   * @returns {number}
   */
  get length() {
    return this.docIds.length;
  }

  /**
   * Returns raw array of Document IDs.
   * @returns {number[]}
   */
  getDocIds() {
    return this.docIds;
  }

  /**
   * Converts the Document IDs into a contiguous, cache-friendly typed buffer.
   * Bypasses standard V8 64-bit object pointer overhead.
   *
   * @returns {Uint32Array}
   */
  toUint32Array() {
    return new Uint32Array(this.docIds);
  }

  /**
   * Returns array of structured posting records.
   * @returns {Array<{ docId: number, tf: number }>}
   */
  getPostings() {
    return this.docIds.map((id, index) => ({
      docId: id,
      tf: this.termFreqs[index],
    }));
  }
}

/**
 * Class implementing high-throughput Boolean set intersection algorithms
 * across sorted posting lists.
 */
export class TwoPointerIntersector {
  /**
   * Intersects two sorted Document ID lists in linear O(L1 + L2) time.
   * Employs synchronized dual cursors advancing monotonically.
   *
   * @param {number[] | Uint32Array | SortedPostingList} listA
   * @param {number[] | Uint32Array | SortedPostingList} listB
   * @returns {{ matches: number[], operations: number }}
   */
  static intersect2(listA, listB) {
    const arrA = listA instanceof SortedPostingList ? listA.getDocIds() : listA;
    const arrB = listB instanceof SortedPostingList ? listB.getDocIds() : listB;

    const lenA = arrA.length;
    const lenB = arrB.length;
    const matches = [];

    let p1 = 0;
    let p2 = 0;
    let operations = 0;

    while (p1 < lenA && p2 < lenB) {
      operations++;
      const docA = arrA[p1];
      const docB = arrB[p2];

      if (docA === docB) {
        matches.push(docA);
        p1++;
        p2++;
      } else if (docA < docB) {
        p1++;
      } else {
        p2++;
      }
    }

    return { matches, operations };
  }

  /**
   * Intersects three or more posting lists using the Shortest-List-First heuristic.
   * Sorts candidate lists by length ascending to minimize intermediate set size.
   * Short-circuits immediately if any intermediate intersection yields an empty set.
   *
   * @param {Array<number[] | Uint32Array | SortedPostingList>} postingLists
   * @returns {{ matches: number[], totalOperations: number }}
   */
  static intersectMulti(postingLists) {
    if (!Array.isArray(postingLists) || postingLists.length === 0) {
      return { matches: [], totalOperations: 0 };
    }

    if (postingLists.length === 1) {
      const single = postingLists[0];
      const arr = single instanceof SortedPostingList ? single.getDocIds() : single;
      return { matches: [...arr], totalOperations: 0 };
    }

    // 1. Convert all inputs to standard arrays for uniform length inspection
    const normalizedLists = postingLists.map((p) =>
      p instanceof SortedPostingList ? p.getDocIds() : p
    );

    // 2. Sort lists by length ascending: Shortest-List-First Optimization Heuristic
    // This bounds intermediate results to min(|L1|, |L2|, ..., |Lk|)
    normalizedLists.sort((a, b) => a.length - b.length);

    let runningMatches = [...normalizedLists[0]];
    let totalOperations = 0;

    // 3. Iteratively intersect running result against subsequent lists
    for (let i = 1; i < normalizedLists.length; i++) {
      if (runningMatches.length === 0) {
        // Short-circuit: empty intersection cannot regain elements
        break;
      }

      const { matches, operations } = TwoPointerIntersector.intersect2(
        runningMatches,
        normalizedLists[i]
      );
      runningMatches = matches;
      totalOperations += operations;
    }

    return { matches: runningMatches, totalOperations };
  }
}

/**
 * Class implementing Delta Gap Compression for sorted integer sequences.
 * Maps sorted document IDs [1000, 1004, 1007, ...] to difference gaps [1000, 4, 3, ...].
 */
export class DeltaCompressor {
  /**
   * Encodes a strictly sorted Document ID array into delta gaps.
   *
   * @param {number[] | Uint32Array} sortedDocIds
   * @returns {number[]}
   */
  static encode(sortedDocIds) {
    if (!sortedDocIds || sortedDocIds.length === 0) {
      return [];
    }

    const deltas = new Array(sortedDocIds.length);
    deltas[0] = sortedDocIds[0];

    for (let i = 1; i < sortedDocIds.length; i++) {
      deltas[i] = sortedDocIds[i] - sortedDocIds[i - 1];
    }

    return deltas;
  }

  /**
   * Decodes delta gaps back into absolute Document IDs via cumulative prefix sums.
   *
   * @param {number[] | Uint32Array} deltas
   * @returns {number[]}
   */
  static decode(deltas) {
    if (!deltas || deltas.length === 0) {
      return [];
    }

    const reconstructed = new Array(deltas.length);
    reconstructed[0] = deltas[0];

    for (let i = 1; i < deltas.length; i++) {
      reconstructed[i] = reconstructed[i - 1] + deltas[i];
    }

    return reconstructed;
  }

  /**
   * Estimates raw memory bytes (4 bytes per 32-bit int) versus variable-byte compressed size.
   * Small integers (< 128) consume 1 byte in VByte; integers < 16384 consume 2 bytes.
   *
   * @param {number[]} deltas
   * @returns {{ rawBytes: number, compressedBytes: number, savingsPercent: number }}
   */
  static estimateMemorySavings(deltas) {
    const rawBytes = deltas.length * 4; // 32-bit integer = 4 bytes
    let compressedBytes = 0;

    for (const val of deltas) {
      if (val < 128) {
        compressedBytes += 1;
      } else if (val < 16384) {
        compressedBytes += 2;
      } else if (val < 2097152) {
        compressedBytes += 3;
      } else {
        compressedBytes += 4;
      }
    }

    const savingsPercent = rawBytes === 0 ? 0 : ((rawBytes - compressedBytes) / rawBytes) * 100;
    return { rawBytes, compressedBytes, savingsPercent };
  }
}
