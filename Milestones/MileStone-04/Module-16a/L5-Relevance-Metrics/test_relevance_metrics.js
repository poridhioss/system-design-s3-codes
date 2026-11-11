import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SearchEvaluator } from "./IREvaluator.js";

describe("Suite 1: Ground-Truth Ingestion & Graded Relevance Mapping", () => {
  const evaluator = new SearchEvaluator();
  it("loads 6 benchmark queries from judgments file", () => {
    assert.strictEqual(evaluator.data.queries.length, 6);
  });
  it("retrieves relevant document IDs using query text and query ID", () => {
    assert.deepStrictEqual(Array.from(evaluator.getRelevantDocs("A1", 1)).sort(), [101, 104, 108]);
  });
  it("filters documents accurately by minimum relevance grade", () => {
    assert.strictEqual(evaluator.getRelevantDocs("A1", 1).has(108), true);
    assert.strictEqual(evaluator.getRelevantDocs("A1", 2).has(108), false);
    assert.strictEqual(evaluator.getRelevantDocs("A1", 1).has(115), false);
  });
  it("returns empty Set safely for non-existent queries", () => {
    assert.strictEqual(evaluator.getRelevantDocs("unknown query xyz", 1).size, 0);
  });
});

describe("Suite 2: Precision@K and Recall@K Cutoff Dynamics", () => {
  const relevant = new Set([10, 20, 30]);
  it("computes precision and recall correctly for standard cutoffs", () => {
    const retrieved = [10, 99, 20, 88, 77];
    assert.strictEqual(SearchEvaluator.precisionAtK(retrieved, relevant, 1), 1.0);
    assert.strictEqual(SearchEvaluator.recallAtK(retrieved, relevant, 1), 0.3333);
    assert.strictEqual(SearchEvaluator.precisionAtK(retrieved, relevant, 3), 0.6667);
    assert.strictEqual(SearchEvaluator.recallAtK(retrieved, relevant, 3), 0.6667);
    assert.strictEqual(SearchEvaluator.precisionAtK(retrieved, relevant, 5), 0.4);
    assert.strictEqual(SearchEvaluator.recallAtK(retrieved, relevant, 5), 0.6667);
  });
  it("handles edge cases: empty retrieved list and k <= 0 safely", () => {
    assert.strictEqual(SearchEvaluator.precisionAtK([], relevant, 3), 0.0);
    assert.strictEqual(SearchEvaluator.recallAtK([], relevant, 3), 0.0);
    assert.strictEqual(SearchEvaluator.precisionAtK([10], relevant, 0), 0.0);
    assert.strictEqual(SearchEvaluator.recallAtK([10], relevant, -1), 0.0);
  });
  it("returns 0.0 when retrieved list contains zero relevant documents", () => {
    assert.strictEqual(SearchEvaluator.precisionAtK([91, 92], relevant, 2), 0.0);
  });
});

describe("Suite 3: Reciprocal Rank (RR) for Navigational Search", () => {
  const relevant = new Set([101, 102]);
  it("returns 1.0 when the first relevant document is at Rank 1", () => {
    assert.strictEqual(SearchEvaluator.reciprocalRank([101, 999], relevant), 1.0);
  });
  it("returns 1/rank for relevant documents appearing at deeper ranks", () => {
    assert.strictEqual(SearchEvaluator.reciprocalRank([999, 102], relevant), 0.5);
    assert.strictEqual(SearchEvaluator.reciprocalRank([999, 998, 101], relevant), 0.3333);
    assert.strictEqual(SearchEvaluator.reciprocalRank([999, 998, 997, 996, 102], relevant), 0.2);
  });
  it("returns 0.0 when no relevant document is retrieved", () => {
    assert.strictEqual(SearchEvaluator.reciprocalRank([999, 998], relevant), 0.0);
  });
});

describe("Suite 4: Average Precision (AP) & Rank Position Sensitivity", () => {
  const relevant = new Set([1, 2, 3]);
  it("rewards rankings with relevant hits at the top", () => {
    const apA = SearchEvaluator.averagePrecision([1, 2, 99, 98, 3], relevant); // hits at 1, 2, 5
    const apB = SearchEvaluator.averagePrecision([99, 1, 2, 3, 98], relevant); // hits at 2, 3, 4
    assert.strictEqual(apA, 0.8667);
    assert.strictEqual(apB, 0.6389);
    assert.ok(apA > apB, "Top-heavy ranking must yield higher AP");
  });
  it("computes exact manual calculation for mixed relevance list", () => {
    assert.strictEqual(SearchEvaluator.averagePrecision([10, 99, 20], new Set([10, 20])), 0.8333);
  });
  it("handles zero-match and empty input lists safely", () => {
    assert.strictEqual(SearchEvaluator.averagePrecision([], relevant), 0.0);
    assert.strictEqual(SearchEvaluator.averagePrecision([91, 92], relevant), 0.0);
    assert.strictEqual(SearchEvaluator.averagePrecision([1, 2], new Set()), 0.0);
  });
});

describe("Suite 5: Single-Query Evaluation & Suite Macro-Aggregation", () => {
  const evaluator = new SearchEvaluator();
  it("evaluates a single query and returns complete metrics dictionary", () => {
    const m = evaluator.evaluateRetrieval("A1", [101, 999, 104], [1, 3], 1);
    assert.strictEqual(m.query, "A1");
    assert.strictEqual(m["precision@1"], 1.0);
    assert.strictEqual(m["precision@3"], 0.6667);
    assert.strictEqual(m.reciprocalRank, 1.0);
  });
  it("aggregates multiple queries into MAP and MRR correctly", () => {
    const q1 = { averagePrecision: 0.8, reciprocalRank: 1.0, "precision@1": 1.0, "recall@3": 0.6667 };
    const q2 = { averagePrecision: 0.4, reciprocalRank: 0.5, "precision@1": 0.0, "recall@3": 0.3333 };
    const s = evaluator.aggregateSuite([q1, q2]);
    assert.strictEqual(s.queryCount, 2);
    assert.strictEqual(s.meanAveragePrecision, 0.6);
    assert.strictEqual(s.meanReciprocalRank, 0.75);
  });
});
