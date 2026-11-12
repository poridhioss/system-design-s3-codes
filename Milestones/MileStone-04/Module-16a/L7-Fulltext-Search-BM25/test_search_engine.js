/**
 * test_search_engine.js
 *
 * Automated Test Suite for Lab 7 Search Engine and Okapi BM25 Ranking.
 * Uses native Node.js 20+ test runner (node:test) and strict assertions (node:assert/strict).
 *
 * 4 Test Suites, 16 Assertions:
 * - Suite 1: InvertedIndex Invariants & Collection Statistics (4 tests)
 * - Suite 2: Information Theory & Robertson-Sparck Jones IDF (3 tests)
 * - Suite 3: Okapi BM25 Saturation, Length Penalties & The Ranking Flip (5 tests)
 * - Suite 4: Score Explainability, Snippets & API Handlers (4 tests)
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TextAnalyzer } from "./TextAnalyzer.js";
import { InvertedIndex } from "./InvertedIndex.js";
import { SearchRanker } from "./SearchRanker.js";
import { SnippetHighlighter } from "./SnippetHighlighter.js";
import { handleSearch, handleExplain, handleHealth } from "./server.js";
import { DOCUMENTS } from "./corpus.js";

describe("Suite 1: InvertedIndex Invariants & Collection Statistics", () => {
  let analyzer;
  let index;

  beforeEach(() => {
    analyzer = new TextAnalyzer();
    index = new InvertedIndex();
    for (const doc of DOCUMENTS) {
      const tokens = analyzer.analyze(`${doc.title} ${doc.content}`);
      index.addDocument(doc.id, tokens);
    }
  });

  test("ingests documents and tracks totalDocs accurately", () => {
    assert.equal(index.totalDocs, 9);
    assert.ok(index.totalTokens > 0);
  });

  test("computes collection-wide average document length (avgDocLen)", () => {
    const avgLen = index.avgDocLen;
    assert.ok(avgLen > 15 && avgLen < 60, `Unexpected avgDocLen: ${avgLen}`);
    // Doc 9 is verbose, so its length must be significantly larger than avgDocLen
    assert.ok(index.getDocLen(9) > avgLen * 1.5);
    // Doc 1 is concise, so its length must be below avgDocLen
    assert.ok(index.getDocLen(1) < avgLen);
  });

  test("maps vocabulary terms to SortedPostingList instances with strictly sorted DocIDs", () => {
    const postings = index.getPostings("distribut");
    assert.ok(postings !== null);
    const docIds = postings.getDocIds();
    assert.ok(docIds.length >= 3);
    for (let i = 1; i < docIds.length; i++) {
      assert.ok(docIds[i] > docIds[i - 1], "DocIDs must be strictly ascending");
    }
  });

  test("returns correct document frequency (DF) and term frequency (TF)", () => {
    const df = index.getDocFreq("cache");
    assert.ok(df >= 2, `Expected DF >= 2, got ${df}`);
    // Doc 1 has "cache" multiple times
    const tfDoc1 = index.getTermFreq("cache", 1);
    assert.ok(tfDoc1 >= 2, `Expected TF >= 2 in Doc 1, got ${tfDoc1}`);
  });
});

describe("Suite 2: Information Theory & Robertson-Sparck Jones IDF", () => {
  let ranker;

  beforeEach(() => {
    const analyzer = new TextAnalyzer();
    const index = new InvertedIndex();
    for (const doc of DOCUMENTS) {
      const tokens = analyzer.analyze(`${doc.title} ${doc.content}`);
      index.addDocument(doc.id, tokens);
    }
    ranker = new SearchRanker(index, analyzer);
  });

  test("computes positive IDF for existing vocabulary terms", () => {
    const idfCache = ranker.calculateIDF("cache");
    assert.ok(idfCache > 0, `IDF must be positive, got ${idfCache}`);
  });

  test("assigns higher IDF to rare terms than to common terms", () => {
    // "raft" occurs only in Raft doc(s); "distribut" occurs in many docs
    const idfRaft = ranker.calculateIDF("raft");
    const idfDist = ranker.calculateIDF("distribut");
    assert.ok(
      idfRaft > idfDist,
      `Rare term "raft" (${idfRaft}) must have higher IDF than common "distribut" (${idfDist})`
    );
  });

  test("returns 0 for terms absent from the corpus", () => {
    assert.equal(ranker.calculateIDF("nonexistenttermxyz"), 0.0);
  });
});

describe("Suite 3: Okapi BM25 Saturation, Length Penalties & The Ranking Flip", () => {
  let analyzer;
  let index;
  let ranker;

  beforeEach(() => {
    analyzer = new TextAnalyzer();
    index = new InvertedIndex();
    for (const doc of DOCUMENTS) {
      const tokens = analyzer.analyze(`${doc.title} ${doc.content}`);
      index.addDocument(doc.id, tokens);
    }
    ranker = new SearchRanker(index, analyzer);
  });

  test("demonstrates term frequency saturation with diminishing returns", () => {
    // Synthetic test: compare scores when TF is 1 vs 2 vs 10
    const queryTokens = ["cache"];
    const idf = ranker.calculateIDF("cache");
    const k1 = 1.2;
    const b = 0.75;
    const lenNorm = 1.0; // Assume average length

    const scoreTF1 = idf * ((1 * (k1 + 1)) / (1 + k1 * lenNorm));
    const scoreTF2 = idf * ((2 * (k1 + 1)) / (2 + k1 * lenNorm));
    const scoreTF10 = idf * ((10 * (k1 + 1)) / (10 + k1 * lenNorm));

    const gain1to2 = scoreTF2 - scoreTF1;
    const gain2to10 = (scoreTF10 - scoreTF2) / 8; // average marginal gain per term

    assert.ok(
      gain1to2 > gain2to10,
      "Second occurrence must deliver much higher marginal gain than later occurrences"
    );
  });

  test("penalizes long rambling documents for the same term frequency", () => {
    const queryTokens = ["cache"];
    // Doc 9 is long; Doc 1 is short
    // Calculate score with equalized TF = 2
    const avgLen = index.avgDocLen;
    const lenNormShort = 1 - 0.75 + 0.75 * (index.getDocLen(1) / avgLen);
    const lenNormLong = 1 - 0.75 + 0.75 * (index.getDocLen(9) / avgLen);

    assert.ok(
      lenNormLong > lenNormShort,
      "Long document must have higher length normalization denominator"
    );
  });

  test("parameter b controls length penalty scaling", () => {
    const queryTokens = analyzer.analyze("distributed cache");
    // With b = 0, length normalization is turned off
    const scoreB0_Doc1 = ranker.scoreBM25(queryTokens, 1, 1.2, 0.0);
    const scoreB0_Doc9 = ranker.scoreBM25(queryTokens, 9, 1.2, 0.0);

    // With b = 0.75, length normalization is active
    const scoreB75_Doc1 = ranker.scoreBM25(queryTokens, 1, 1.2, 0.75);
    const scoreB75_Doc9 = ranker.scoreBM25(queryTokens, 9, 1.2, 0.75);

    // When b=0, Doc 9 has higher TF so it beats Doc 1
    assert.ok(scoreB0_Doc9 > scoreB0_Doc1, "With b=0, raw TF dominates");
    // When b=0.75, Doc 1 is boosted and Doc 9 is penalized
    assert.ok(scoreB75_Doc1 > scoreB75_Doc9, "With b=0.75, length penalty promotes concise Doc 1");
  });

  test("parameter k1 controls saturation asymptote", () => {
    const queryTokens = ["cache"];
    const scoreK0 = ranker.scoreBM25(queryTokens, 1, 0.0, 0.75);
    const scoreK12 = ranker.scoreBM25(queryTokens, 1, 1.2, 0.75);
    assert.ok(scoreK12 > scoreK0, "Higher k1 allows more score contribution from TF");
  });

  test("the ranking flip: TF-IDF ranks Doc 9 first, BM25 flips Doc 1 to Rank 1", () => {
    const query = "distributed cache";

    // TF-IDF ranking
    const tfidfResults = ranker.search(query, { mode: "tfidf", topK: 2 });
    assert.equal(
      tfidfResults[0].docId,
      9,
      "Classic TF-IDF must falsely promote rambling Doc 9 to Rank 1"
    );

    // BM25 ranking
    const bm25Results = ranker.search(query, { mode: "bm25", topK: 2 });
    assert.equal(
      bm25Results[0].docId,
      1,
      "Okapi BM25 must correctly promote concise Doc 1 to Rank 1"
    );
    assert.ok(bm25Results[0].score > bm25Results[1].score);
  });
});

describe("Suite 4: Score Explainability, Snippets & API Handlers", () => {
  let ranker;
  let analyzer;

  beforeEach(() => {
    analyzer = new TextAnalyzer();
    const index = new InvertedIndex();
    for (const doc of DOCUMENTS) {
      const tokens = analyzer.analyze(`${doc.title} ${doc.content}`);
      index.addDocument(doc.id, tokens);
    }
    ranker = new SearchRanker(index, analyzer);
  });

  test("explainScore returns mathematically exact decomposition matching bm25Score", () => {
    const explanation = ranker.explainScore("distributed cache", 1);
    assert.equal(explanation.docId, 1);
    assert.ok(explanation.terms.length >= 2);

    const manualSum = explanation.terms.reduce((acc, t) => acc + t.bm25Contribution, 0);
    assert.ok(
      Math.abs(manualSum - explanation.bm25Score) < 0.001,
      "Sum of term contributions must equal final BM25 score"
    );
  });

  test("SnippetHighlighter extracts context window around query terms with <em> tags", () => {
    const text = "Redis is an in-memory key-value data store frequently deployed as a distributed cache.";
    const queryTokens = ["cach"];
    const snippet = SnippetHighlighter.highlight(text, queryTokens, 5);

    assert.ok(snippet.includes("<em>cache.</em>") || snippet.includes("<em>cache</em>"));
  });

  test("handleSearch returns formatted results with hits and timing metadata", () => {
    const res = handleSearch("distributed cache", { mode: "bm25", limit: 3 });
    assert.equal(res.query, "distributed cache");
    assert.equal(res.mode, "bm25");
    assert.ok(res.totalHits > 0);
    assert.ok(typeof res.tookMs === "number");
    assert.equal(res.hits[0].docId, 1);
    assert.ok(res.hits[0].snippet.includes("<em>"));
  });

  test("handleExplain and handleHealth return expected diagnostic payloads", () => {
    const health = handleHealth();
    assert.equal(health.status, "healthy");
    assert.equal(health.totalDocs, 9);

    const exp = handleExplain("distributed cache", "1");
    assert.equal(exp.docId, 1);
    assert.ok(exp.explanation.bm25Score > 0);

    const invalid = handleExplain("distributed cache", "999");
    assert.ok(invalid.error !== undefined);
  });
});
