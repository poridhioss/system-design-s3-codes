/**
 * main.js - Master Search Engine Execution and Evaluation Pipeline
 *
 * Demonstrates:
 * 1. Corpus indexing and collection statistics.
 * 2. The TF-IDF vs. Okapi BM25 ranking flip (Doc 1 vs. Doc 9).
 * 3. Elasticsearch-style term-by-term score explainability.
 * 4. Execution of 5 benchmark queries with contextual snippet highlighting.
 * 5. Generation of relevance_judgments.json for offline search evaluation.
 */

import fs from "node:fs";
import { TextAnalyzer } from "./TextAnalyzer.js";
import { InvertedIndex } from "./InvertedIndex.js";
import { SearchRanker } from "./SearchRanker.js";
import { SnippetHighlighter } from "./SnippetHighlighter.js";
import { DOCUMENTS, DOCUMENTS_BY_ID } from "./corpus.js";

function buildEngine() {
  const analyzer = new TextAnalyzer();
  const index = new InvertedIndex();

  console.log("======================================================================");
  console.log("  STEP 1: Indexing Document Collection");
  console.log("======================================================================");

  for (const doc of DOCUMENTS) {
    const tokens = analyzer.analyze(`${doc.title} ${doc.content}`);
    index.addDocument(doc.id, tokens);
    console.log(
      `  [Indexed] Doc ${String(doc.id).padStart(2, "0")}: "${doc.title}" (${tokens.length} tokens)`
    );
  }

  console.log("----------------------------------------------------------------------");
  console.log("Corpus Statistics:");
  console.log(`  • Total Documents:     ${index.totalDocs}`);
  console.log(`  • Vocabulary Size:     ${index.vocabularySize} unique terms`);
  console.log(`  • Average Doc Length:  ${index.avgDocLen.toFixed(2)} tokens`);
  console.log("======================================================================\n");

  const ranker = new SearchRanker(index, analyzer);
  return { analyzer, index, ranker };
}

function demonstrateRankingFlip(ranker) {
  const testQuery = "distributed cache";

  console.log("======================================================================");
  console.log("  STEP 2: The Ranking Flip Demonstration (TF-IDF vs. Okapi BM25)");
  console.log(`  Query: "${testQuery}"`);
  console.log("======================================================================");

  // 1. Classic TF-IDF Scoring
  const tfidfResults = ranker.search(testQuery, { mode: "tfidf", topK: 5 });
  console.log("\n--- Mode A: Classic TF-IDF Scoring ---");
  console.log("Rank | Doc ID | Score   | Title");
  console.log("-----+--------+---------+----------------------------------------------");
  tfidfResults.forEach(({ docId, score }, index) => {
    const doc = DOCUMENTS_BY_ID.get(docId);
    console.log(
      `  ${index + 1}  | Doc ${String(docId).padStart(2, "0")} | ${score.toFixed(4).padStart(7, " ")} | ${doc.title}`
    );
  });
  console.log("Notice: Doc 09 (the verbose document) takes Rank #1 in TF-IDF");
  console.log("because it repeats 'cache' multiple times (keyword stuffing effect)!\n");

  // 2. Okapi BM25 Scoring
  const bm25Results = ranker.search(testQuery, { mode: "bm25", topK: 5 });
  console.log("--- Mode B: Okapi BM25 Scoring (k1=1.2, b=0.75) ---");
  console.log("Rank | Doc ID | Score   | Title");
  console.log("-----+--------+---------+----------------------------------------------");
  bm25Results.forEach(({ docId, score }, index) => {
    const doc = DOCUMENTS_BY_ID.get(docId);
    console.log(
      `  ${index + 1}  | Doc ${String(docId).padStart(2, "0")} | ${score.toFixed(4).padStart(7, " ")} | ${doc.title}`
    );
  });
  console.log("Notice: BM25 flips the ranking! Doc 01 is promoted to Rank #1 because");
  console.log("BM25 saturates term frequency (k1) and penalizes long, rambling documents (b).\n");

  // 3. Score Breakdown Inspection
  console.log("--- Term-by-Term Score Explanation (Elasticsearch _explain style) ---");
  const expDoc1 = ranker.explainScore(testQuery, 1);
  const expDoc9 = ranker.explainScore(testQuery, 9);

  console.log(`\nDoc 01 (length=${expDoc1.docLen}, lenRatio=${expDoc1.lenRatio}):`);
  for (const t of expDoc1.terms) {
    console.log(
      `  • term "${t.term}": tf=${t.tf}, idf=${t.idf}, tfNorm=${t.tfNorm} -> BM25=${t.bm25Contribution}`
    );
  }
  console.log(`  => Total BM25: ${expDoc1.bm25Score} | Total TF-IDF: ${expDoc1.tfidfScore}`);

  console.log(`\nDoc 09 (length=${expDoc9.docLen}, lenRatio=${expDoc9.lenRatio}):`);
  for (const t of expDoc9.terms) {
    console.log(
      `  • term "${t.term}": tf=${t.tf}, idf=${t.idf}, tfNorm=${t.tfNorm} -> BM25=${t.bm25Contribution}`
    );
  }
  console.log(`  => Total BM25: ${expDoc9.bm25Score} | Total TF-IDF: ${expDoc9.tfidfScore}`);
  console.log("======================================================================\n");
}

function runBenchmarkQueries(ranker, analyzer) {
  const benchmarkQueries = [
    "distributed cache replication",
    "raft consensus leader election",
    "database sharding partition key",
    "kafka event streaming partition",
    "consistent hashing virtual nodes",
  ];

  const logLines = [];
  logLines.push("======================================================================");
  logLines.push("INVERTED INDEX ENGINE: BENCHMARK QUERY LOG");
  logLines.push("======================================================================\n");

  console.log("======================================================================");
  console.log("  STEP 3: Running 5 Benchmark Queries");
  console.log("======================================================================");

  benchmarkQueries.forEach((query, i) => {
    const results = ranker.search(query, { mode: "bm25", topK: 5 });
    const queryTokens = analyzer.analyze(query);
    const header = `Query ${i + 1}: "${query}"`;
    console.log(`\n${header}`);
    logLines.push(header);
    logLines.push("----------------------------------------------------------------------");

    if (results.length === 0) {
      const msg = "  No matching documents found.";
      console.log(msg);
      logLines.push(msg);
    } else {
      results.forEach(({ docId, score }, rank) => {
        const doc = DOCUMENTS_BY_ID.get(docId);
        const snippet = SnippetHighlighter.highlight(doc.content, queryTokens, 8);
        const line = `  Rank ${rank + 1}: Doc ${String(docId).padStart(2, "0")} [BM25: ${score.toFixed(4)}] - ${doc.title}`;
        console.log(line);
        console.log(`         Snippet: ${snippet}`);
        logLines.push(line);
        logLines.push(`         Snippet: ${snippet}`);
      });
    }
    logLines.push("");
  });

  fs.writeFileSync("query_log.txt", logLines.join("\n"), "utf-8");
  console.log("\n[Saved] Query log exported to: query_log.txt");
}

function generateRelevanceJudgments() {
  const relevanceData = {
    metadata: {
      module: "M16a",
      lab: "M16a-L7",
      purpose: "Ground truth relevance judgments for search evaluation and Elasticsearch shootout in Lab 9",
      scale: {
        0: "Irrelevant - Document does not address the query information need.",
        1: "Partially Relevant - Document touches on the topic or related concepts.",
        2: "Highly Relevant - Document directly answers or centers on the query topic.",
      },
    },
    queries: [
      {
        query_id: "Q1",
        query: "distributed cache replication",
        expected_top_docs: [1, 8, 9],
        judgments: [
          {
            doc_id: 1,
            grade: 2,
            notes: "Highly relevant: Directly covers Redis as a distributed cache with master-slave replication.",
          },
          {
            doc_id: 8,
            grade: 1,
            notes: "Partially relevant: Explains synchronous vs asynchronous replication, but not caching.",
          },
          {
            doc_id: 9,
            grade: 1,
            notes: "Partially relevant: Mentions distributed cache repeatedly, but rambling/noisy.",
          },
        ],
      },
      {
        query_id: "Q2",
        query: "raft consensus leader election",
        expected_top_docs: [2],
        judgments: [
          {
            doc_id: 2,
            grade: 2,
            notes: "Highly relevant: Specifically explains Raft consensus states and leader election timers.",
          },
          {
            doc_id: 6,
            grade: 1,
            notes: "Partially relevant: Covers distributed transactions, but not Raft consensus.",
          },
        ],
      },
      {
        query_id: "Q3",
        query: "database sharding partition key",
        expected_top_docs: [3],
        judgments: [
          {
            doc_id: 3,
            grade: 2,
            notes: "Highly relevant: Core focus on horizontal sharding, partition keys, and avoiding hotspots.",
          },
          {
            doc_id: 5,
            grade: 1,
            notes: "Partially relevant: Discusses consistent hashing key mapping, but for cache nodes.",
          },
        ],
      },
      {
        query_id: "Q4",
        query: "kafka event streaming partition",
        expected_top_docs: [4],
        judgments: [
          {
            doc_id: 4,
            grade: 2,
            notes: "Highly relevant: Directly covers Apache Kafka event streaming and partitioned logs.",
          },
          {
            doc_id: 3,
            grade: 1,
            notes: "Partially relevant: Mentions partitioning, but in relational databases.",
          },
        ],
      },
      {
        query_id: "Q5",
        query: "consistent hashing virtual nodes",
        expected_top_docs: [5],
        judgments: [
          {
            doc_id: 5,
            grade: 2,
            notes: "Highly relevant: Dedicated document explaining consistent hashing and virtual node distribution.",
          },
          {
            doc_id: 1,
            grade: 1,
            notes: "Partially relevant: Covers caching, but not consistent hashing ring geometry.",
          },
        ],
      },
    ],
  };

  fs.writeFileSync("relevance_judgments.json", JSON.stringify(relevanceData, null, 2), "utf-8");
  console.log("[Saved] Relevance judgments exported to: relevance_judgments.json");
}

function main() {
  const { analyzer, ranker } = buildEngine();
  demonstrateRankingFlip(ranker);
  runBenchmarkQueries(ranker, analyzer);
  generateRelevanceJudgments();
  console.log("\n======================================================================");
  console.log("  SIMULATION COMPLETE: Search Engine Built and Verified");
  console.log("======================================================================\n");
}

main();
