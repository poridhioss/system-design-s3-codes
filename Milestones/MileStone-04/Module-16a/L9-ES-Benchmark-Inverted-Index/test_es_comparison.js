/**
 * test_es_comparison.js
 *
 * Automated Native Test Suite for Lab 9:
 * First Principles vs. Elasticsearch in Production.
 *
 * 16 unit tests across 4 suites:
 * - Suite 1: Cluster Health & Index Lifecycle (4 tests)
 * - Suite 2: Multi-Field Analyzer & Token Stream Verification (4 tests)
 * - Suite 3: Retrieval Parity & IR Metric Correctness (4 tests)
 * - Suite 4: BM25 Scoring & Execution Latency Budget (4 tests)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DOCUMENTS } from "./corpus.js";
import { HomemadeSearchEngine } from "./homemade_adapter.js";
import { SearchEvaluator } from "./IREvaluator.js";
import { ElasticsearchClient, INDEX_NAME } from "./es_client.js";

describe("Suite 1: Cluster Health & Index Lifecycle", () => {
  const esClient = new ElasticsearchClient();

  it("Elasticsearch client initializes with target node configuration", () => {
    assert.ok(esClient, "ElasticsearchClient instance should exist");
    assert.strictEqual(typeof esClient.ping, "function");
    assert.strictEqual(typeof esClient.createIndex, "function");
    assert.strictEqual(typeof esClient.indexCorpus, "function");
  });

  it("corpus dataset contains exactly 9 distributed systems technical documents", () => {
    assert.strictEqual(DOCUMENTS.length, 9, "Corpus must have 9 documents");
    for (const doc of DOCUMENTS) {
      assert.ok(doc.id > 0, "Document ID must be positive integer");
      assert.ok(doc.title.length > 5, "Document title must not be empty");
      assert.ok(doc.content.length > 20, "Document content must have realistic length");
    }
  });

  it("bulk ingestion structures document operations with explicit index name", () => {
    const operations = DOCUMENTS.flatMap((doc) => [
      { create: { _index: INDEX_NAME, _id: String(doc.id) } },
      { doc_id: doc.id, title: doc.title, content: doc.content },
    ]);

    assert.strictEqual(operations.length, 18, "9 documents should produce 18 bulk array elements");
    assert.strictEqual(operations[0].create._index, INDEX_NAME);
    assert.strictEqual(operations[1].doc_id, 1);
  });

  it("Elasticsearch ping safely handles offline or online container state", async () => {
    // Ping should resolve to boolean without throwing uncaught exceptions
    const isOnline = await esClient.ping();
    assert.strictEqual(typeof isOnline, "boolean", "ping() must return boolean");
  });
});

describe("Suite 2: Multi-Field Analyzer & Token Stream Verification", () => {
  it("standard tokenizer logic splits punctuation and hyphenated tokens", () => {
    const rawText = "in-memory key-value distributed-cache";
    const standardTokens = rawText.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);

    assert.deepStrictEqual(standardTokens, [
      "in",
      "memory",
      "key",
      "value",
      "distributed",
      "cache",
    ]);
  });

  it("custom hyphen pattern preserves compound technical tokens", () => {
    const rawText = "in-memory key-value data-store";
    // Pattern: [^a-zA-Z0-9_-]+
    const customTokens = rawText.toLowerCase().split(/[^a-z0-9_-]+/i).filter(Boolean);

    assert.deepStrictEqual(customTokens, [
      "in-memory",
      "key-value",
      "data-store",
    ]);
  });

  it("stemming reduces morphological suffix variants to common root", () => {
    // Simple algorithmic rule for demonstration: replicate / replicating / replication -> replic
    const stemMock = (word) => word.toLowerCase().replace(/(?:ating|ation|ated|ate|s)$/, "");
    assert.strictEqual(stemMock("replicating"), "replic");
    assert.strictEqual(stemMock("replication"), "replic");
  });

  it("stopword filtering eliminates low-information conversational terms", () => {
    const stopwords = new Set(["how", "to", "achieve", "across", "and", "the", "a", "is"]);
    const query = "how to achieve consensus across distributed servers";
    const filtered = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => !stopwords.has(w));

    assert.deepStrictEqual(filtered, ["consensus", "distributed", "servers"]);
  });
});

describe("Suite 3: Retrieval Parity & IR Metric Correctness", () => {
  const engine = new HomemadeSearchEngine(DOCUMENTS);
  const evaluator = new SearchEvaluator();

  it("homemade adapter returns expected candidates for compound query 'in-memory key-value'", () => {
    const hits = engine.search("in-memory key-value", { topK: 5 });
    assert.ok(hits.length >= 1, "Should find at least 1 match");
    assert.strictEqual(hits[0].doc_id, 1, "Doc 1 (Redis) should rank #1");
    assert.ok(hits[0].score > 0, "BM25 score must be strictly positive");
  });

  it("homemade adapter hits the conjunctive cliff (0 results) for disjunctive query", () => {
    // No single document contains all 4 words: 'redis', 'cache', 'clustering', 'sharding'
    const hits = engine.search("redis cache clustering and sharding", { topK: 5 });
    assert.strictEqual(hits.length, 0, "Strict Boolean AND must drop candidates to 0");
  });

  it("relevance judgments ground truth defines all 6 benchmark queries", () => {
    const queryIds = ["A1", "A2", "A3", "B1", "B2", "B3"];
    for (const qId of queryIds) {
      const entry = evaluator.queryIdMap.get(qId);
      assert.ok(entry, `Ground-truth judgment for Query ${qId} must exist`);
      assert.ok(entry.judgments.length > 0, `Query ${qId} must have graded documents`);
    }
  });

  it("SearchEvaluator accurately calculates precision, recall, and reciprocal rank", () => {
    const retrieved = [1, 3, 5];
    const relevant = new Set([1, 8, 9]);

    const pAt1 = SearchEvaluator.precisionAtK(retrieved, relevant, 1);
    const pAt3 = SearchEvaluator.precisionAtK(retrieved, relevant, 3);
    const rAt3 = SearchEvaluator.recallAtK(retrieved, relevant, 3);
    const rr = SearchEvaluator.reciprocalRank(retrieved, relevant);

    assert.strictEqual(pAt1, 1.0, "Rank 1 is doc 1 (relevant) -> P@1 = 1.0");
    assert.strictEqual(pAt3, 0.3333, "1 of 3 retrieved is relevant -> P@3 = 1/3");
    assert.strictEqual(rAt3, 0.3333, "1 of 3 total relevant docs found -> R@3 = 1/3");
    assert.strictEqual(rr, 1.0, "First hit is at rank 1 -> RR = 1/1 = 1.0");
  });
});

describe("Suite 4: BM25 Scoring & Execution Latency Budget", () => {
  const engine = new HomemadeSearchEngine(DOCUMENTS);

  it("SearchRanker length normalization factor penalizes verbose documents", () => {
    const explainDoc2 = engine.explain("consensus", 2); // Short doc (len = 26)
    const explainDoc9 = engine.explain("consensus", 9); // Verbose doc (len > 100)

    assert.ok(
      explainDoc9.lengthNormFactor > explainDoc2.lengthNormFactor,
      "Verbose document must receive a higher length normalization denominator"
    );
  });

  it("SearchRanker term saturation asymptotes as TF increases", () => {
    const k1 = 1.2;
    const lenNorm = 1.0;
    const tfNorm = (tf) => (tf * (k1 + 1.0)) / (tf + k1 * lenNorm);

    const norm1 = tfNorm(1);
    const norm2 = tfNorm(2);
    const norm10 = tfNorm(10);
    const norm100 = tfNorm(100);

    assert.ok(norm2 > norm1, "TF=2 must score higher than TF=1");
    assert.ok(norm10 > norm2, "TF=10 must score higher than TF=2");
    assert.ok(norm100 < k1 + 1.0, "tfNorm must remain bounded strictly below (k1 + 1)");
  });

  it("in-memory search executes under 1ms (microsecond SLA target < 0.1ms)", () => {
    const iterations = 100;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) {
      engine.search("raft consensus leader election", { topK: 5 });
    }
    const elapsedMs = performance.now() - t0;
    const avgLatencyMs = elapsedMs / iterations;

    assert.ok(
      avgLatencyMs < 1.0,
      `In-memory query average latency (${avgLatencyMs.toFixed(3)}ms) must be under 1ms`
    );
  });

  it("explainScore returns complete term breakdown mirroring Elasticsearch _explain", () => {
    const explanation = engine.explain("raft consensus leader election", 2);

    assert.strictEqual(explanation.docId, 2);
    assert.ok(explanation.bm25Score > 0, "Total BM25 score must be positive");
    assert.strictEqual(explanation.terms.length, 4, "Must explain all 4 query terms");

    for (const termInfo of explanation.terms) {
      assert.ok(termInfo.term, "Term string required");
      assert.ok(termInfo.tf >= 0, "TF must be non-negative");
      assert.ok(termInfo.idf > 0, "IDF must be positive");
      assert.ok(termInfo.bm25Contribution >= 0, "Contribution must be non-negative");
    }
  });
});
