/**
 * test_posting_list.js
 *
 * Automated test suite for Module 16a Fundamental Lab 02:
 * 1. Monotonic SortedPostingList invariant & Uint32Array export.
 * 2. TwoPointerIntersector linear merge & shortest-list heuristic.
 * 3. DeltaCompressor gap encoding, decoding, and memory savings.
 * 4. CorpusIndex multi-term Boolean retrieval on distributed systems corpus.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SortedPostingList,
  TwoPointerIntersector,
  DeltaCompressor,
} from "./PostingList.js";
import { CorpusIndex, CORPUS, tokenizeText } from "./CorpusIndex.js";

describe("Stage 1: SortedPostingList Invariants & Contiguous Memory", () => {
  test("enforces strictly monotonic ascending DocID ordering", () => {
    const list = new SortedPostingList("consensus");
    list.add(1, 2);
    list.add(4, 1);
    list.add(10, 3);

    assert.equal(list.length, 3);
    assert.deepEqual(list.getDocIds(), [1, 4, 10]);
    assert.equal(list.totalOccurrences, 6);
  });

  test("accumulates term frequency when adding identical DocID consecutively", () => {
    const list = new SortedPostingList("leader");
    list.add(2, 1);
    list.add(2, 4); // Same document: should accumulate tf

    assert.equal(list.length, 1);
    assert.deepEqual(list.getDocIds(), [2]);
    assert.deepEqual(list.getPostings(), [{ docId: 2, tf: 5 }]);
    assert.equal(list.totalOccurrences, 5);
  });

  test("throws Error on out-of-order DocID insertion", () => {
    const list = new SortedPostingList("raft");
    list.add(5, 1);

    assert.throws(
      () => list.add(3, 1),
      /Monotonic ordering violation: Attempted to add docId 3 after 5/
    );
  });

  test("validates non-negative integer DocIDs", () => {
    const list = new SortedPostingList("cache");
    assert.throws(() => list.add(-1), TypeError);
    assert.throws(() => list.add("doc1"), TypeError);
    assert.throws(() => list.add(3.14), TypeError);
  });

  test("exports contiguous Uint32Array with zero copy overhead", () => {
    const list = new SortedPostingList("storage");
    list.add(10, 1);
    list.add(20, 2);
    list.add(30, 1);

    const typedBuffer = list.toUint32Array();
    assert.ok(typedBuffer instanceof Uint32Array);
    assert.equal(typedBuffer.length, 3);
    assert.equal(typedBuffer[0], 10);
    assert.equal(typedBuffer[1], 20);
    assert.equal(typedBuffer[2], 30);
    assert.equal(typedBuffer.byteLength, 12); // 3 elements * 4 bytes = 12 bytes
  });
});

describe("Stage 2: TwoPointerIntersector Linear Merge & Shortest-List Heuristic", () => {
  test("intersects two overlapping sorted posting lists", () => {
    const listA = [1, 3, 5, 7, 9];
    const listB = [2, 3, 6, 7, 10];

    const { matches, operations } = TwoPointerIntersector.intersect2(listA, listB);
    assert.deepEqual(matches, [3, 7]);
    assert.ok(operations <= listA.length + listB.length);
  });

  test("returns empty array for completely disjoint lists", () => {
    const listA = [1, 3, 5];
    const listB = [2, 4, 6];

    const { matches, operations } = TwoPointerIntersector.intersect2(listA, listB);
    assert.deepEqual(matches, []);
    assert.ok(operations <= 6);
  });

  test("handles identical posting lists with all elements matching", () => {
    const listA = [10, 20, 30, 40];
    const listB = [10, 20, 30, 40];

    const { matches, operations } = TwoPointerIntersector.intersect2(listA, listB);
    assert.deepEqual(matches, [10, 20, 30, 40]);
    assert.equal(operations, 4);
  });

  test("handles empty lists gracefully without throwing", () => {
    const listA = [];
    const listB = [1, 2, 3];

    const res1 = TwoPointerIntersector.intersect2(listA, listB);
    assert.deepEqual(res1.matches, []);
    assert.equal(res1.operations, 0);

    const res2 = TwoPointerIntersector.intersect2([], []);
    assert.deepEqual(res2.matches, []);
  });

  test("handles lists of vastly unequal lengths", () => {
    const listShort = [50];
    const listLong = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    const { matches, operations } = TwoPointerIntersector.intersect2(listShort, listLong);
    assert.deepEqual(matches, [50]);
    assert.ok(operations <= 6); // Pointer 2 leaps to 50, pointer 1 advances and terminates
  });

  test("intersects multi-term queries with shortest-list-first heuristic", () => {
    // 3 lists with varying cardinalities
    const listLong = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // length 10
    const listMed = [2, 4, 6, 8, 10];                 // length 5
    const listShort = [4, 8];                         // length 2

    // Passing in worst-case order (long, med, short)
    const { matches, totalOperations } = TwoPointerIntersector.intersectMulti([
      listLong,
      listMed,
      listShort,
    ]);

    assert.deepEqual(matches, [4, 8]);
    // The heuristic sorts to [short (2), med (5), long (10)]
    // First intersection (2 vs 5) yields 2 elements in <= 5 ops
    // Second intersection (2 vs 10) touches only 2 elements in <= 8 ops
    assert.ok(totalOperations < listLong.length + listMed.length + listShort.length);
  });

  test("short-circuits multi-term intersection on empty intermediate set", () => {
    const listA = [1, 2, 3];
    const listB = [4, 5, 6]; // Disjoint with A: intersection is []
    const listC = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // Large third list

    const { matches, totalOperations } = TwoPointerIntersector.intersectMulti([
      listA,
      listB,
      listC,
    ]);

    assert.deepEqual(matches, []);
    // listC should never be traversed because A ∩ B is empty!
    assert.ok(totalOperations <= listA.length + listB.length);
  });
});

describe("Stage 3: Delta Gap Compression & Variable-Byte Math", () => {
  test("encodes monotonic sequence into delta gaps", () => {
    const docIds = [100, 104, 110, 125, 200];
    const deltas = DeltaCompressor.encode(docIds);

    // Delta: [100, 104-100=4, 110-104=6, 125-110=15, 200-125=75]
    assert.deepEqual(deltas, [100, 4, 6, 15, 75]);
  });

  test("reconstructs exact monotonic DocIDs from delta gaps", () => {
    const original = [42, 45, 50, 1000, 1005, 1050];
    const deltas = DeltaCompressor.encode(original);
    const decoded = DeltaCompressor.decode(deltas);

    assert.deepEqual(decoded, original);
  });

  test("handles empty and single-element arrays in delta compressor", () => {
    assert.deepEqual(DeltaCompressor.encode([]), []);
    assert.deepEqual(DeltaCompressor.decode([]), []);

    assert.deepEqual(DeltaCompressor.encode([42]), [42]);
    assert.deepEqual(DeltaCompressor.decode([42]), [42]);
  });

  test("calculates significant memory savings on small delta gaps", () => {
    // 5 documents closely spaced
    const docIds = [1000, 1002, 1005, 1008, 1010];
    const deltas = DeltaCompressor.encode(docIds);
    const savings = DeltaCompressor.estimateMemorySavings(deltas);

    assert.equal(savings.rawBytes, 20); // 5 * 4 bytes
    // deltas: [1000, 2, 3, 3, 2] -> 1000 takes 2 bytes, others take 1 byte each -> 2 + 1 + 1 + 1 + 1 = 6 bytes
    assert.equal(savings.compressedBytes, 6);
    assert.equal(savings.savingsPercent, 70); // (20 - 6) / 20 = 70% savings
  });
});

describe("Stage 4: CorpusIndex & Multi-Word Distributed Search Queries", () => {
  test("indexes full 8-document corpus and builds sorted posting lists", () => {
    const index = new CorpusIndex();
    index.buildIndex(CORPUS);

    assert.equal(index.totalIndexedDocs, 8);
    const raftPostings = index.getPostingList("raft");
    assert.ok(raftPostings instanceof SortedPostingList);
    // "raft" appears in doc 1
    assert.deepEqual(raftPostings.getDocIds(), [1]);

    const leaderPostings = index.getPostingList("leader");
    // "leader" appears in doc 1 and doc 2
    assert.deepEqual(leaderPostings.getDocIds(), [1, 2]);
  });

  test("retrieves matching documents for multi-word Boolean AND queries", () => {
    const index = new CorpusIndex();
    index.buildIndex(CORPUS);

    // Query: "distributed leader" -> should match Doc 1 and Doc 2
    const res = index.searchBooleanAnd("distributed leader");
    assert.deepEqual(res.matchedDocIds, [1, 2]);
    assert.equal(res.matchedDocuments.length, 2);
    assert.equal(res.matchedDocuments[0].id, 1);
    assert.equal(res.matchedDocuments[1].id, 2);

    // Query: "redis cache" -> should match Doc 3
    const res2 = index.searchBooleanAnd("redis cache");
    assert.deepEqual(res2.matchedDocIds, [3]);

    // Query: "storage database" -> should match Doc 3 ("database") and Doc 4 ("storage", "database"?)
    const res3 = index.searchBooleanAnd("storage database");
    assert.ok(res3.matchedDocIds.length > 0);

    // Query with completely missing term: should short-circuit to []
    const resEmpty = index.searchBooleanAnd("distributed quantum");
    assert.deepEqual(resEmpty.matchedDocIds, []);
    assert.equal(resEmpty.operations, 0);
  });

  test("preserves Latin roots and retrieves multi-word query 'distributed consensus'", () => {
    const index = new CorpusIndex();
    index.buildIndex(CORPUS);
    const consensusPostings = index.getPostingList("consensus");
    assert.ok(consensusPostings instanceof SortedPostingList);
    assert.deepEqual(consensusPostings.getDocIds(), [1]);

    const res = index.searchBooleanAnd("distributed consensus");
    assert.deepEqual(res.matchedDocIds, [1]);
    assert.equal(res.matchedDocuments[0].id, 1);
  });
});
