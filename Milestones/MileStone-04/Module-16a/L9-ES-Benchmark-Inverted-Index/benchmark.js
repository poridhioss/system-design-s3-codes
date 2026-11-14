/**
 * benchmark.js
 *
 * Performance Benchmark & Comparative Evaluation Runner:
 * Handcrafted In-Memory Engine (Lab 7) vs. Elasticsearch in Production.
 *
 * Evaluates 6 targeted benchmark queries across 4 engine configurations:
 * 1. Handcrafted (Boolean AND + BM25)
 * 2. Elasticsearch (Standard Analyzer, OR)
 * 3. Elasticsearch (English Analyzer + Stemming, OR)
 * 4. Elasticsearch (Exact Hyphen Analyzer, OR)
 *
 * Computes precision, recall, MAP, MRR, and sub-millisecond execution latencies
 * using the Cranfield evaluation framework (SearchEvaluator from Lab 5).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SearchEvaluator } from "./IREvaluator.js";
import { HomemadeSearchEngine } from "./homemade_adapter.js";
import { ElasticsearchClient } from "./es_client.js";
import { DOCUMENTS } from "./corpus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BENCHMARK_QUERIES = [
  {
    id: "A1",
    category: "Elasticsearch Win: Morphological Stemming",
    query: "replicating cache nodes",
    rationale:
      "Tests stemming: Corpus contains 'replication' (Doc 1 & 8). " +
      "Handcrafted Boolean AND fails looking for exact 'replicating'. " +
      "ES English stems to 'replic', achieving high recall.",
  },
  {
    id: "A2",
    category: "Elasticsearch Win: Disjunctive Candidate Retrieval",
    query: "redis cache clustering and sharding",
    rationale:
      "Tests disjunction: Doc 1 covers Redis/cache/cluster, Doc 3 covers sharding. " +
      "Handcrafted Boolean AND fails because no single doc has all 4 terms. " +
      "ES match (OR) surfaces and ranks both relevant documents.",
  },
  {
    id: "A3",
    category: "Elasticsearch Win: Stopword Filtering & IDF Weighting",
    query: "how to achieve consensus across distributed servers",
    rationale:
      "Tests conversational query: 'achieve' is absent from Doc 2. " +
      "Handcrafted AND drops to 0 hits. ES English removes stopwords and " +
      "weights 'consensus' and 'servers' heavily, placing Raft at Rank 1.",
  },
  {
    id: "B1",
    category: "In-Memory Engine Win: Hyphenated Compound Terms",
    query: "in-memory key-value",
    rationale:
      "Tests compound preservation: Handcrafted regex keeps 'in-memory' and " +
      "'key-value' intact, matching Doc 1 with 100% precision. " +
      "Standard analyzer splits punctuation into 4 tokens, causing false hits.",
  },
  {
    id: "B2",
    category: "In-Memory Engine Win: Small-Corpus IDF Separation",
    query: "scatter-gather",
    rationale:
      "Tests IDF precision: Handcrafted unquantized float IDF yields high " +
      "score separation for rare technical terms on tiny corpora, " +
      "whereas Lucene quantizes norms to 1 byte.",
  },
  {
    id: "B3",
    category: "In-Memory Engine Win: Microsecond Execution Latency",
    query: "raft consensus leader election",
    rationale:
      "Tests pure CPU speed: Handcrafted two-pointer merge runs in RAM in " +
      "under 0.05ms with 0 serialization overhead, vs 2-5ms HTTP/REST round-trip.",
  },
];

async function runBenchmark() {
  console.log("==========================================================================================");
  console.log("  PERFORMANCE BENCHMARK: HANDCRAFTED IN-MEMORY ENGINE (LAB 7) vs. ELASTICSEARCH");
  console.log("==========================================================================================");

  const evaluator = new SearchEvaluator();
  console.log(`[*] Loaded ${evaluator.queriesMap.size} ground-truth relevance judgments.`);

  console.log("[*] Initializing Handcrafted Inverted Index in RAM...");
  const tInit0 = performance.now();
  const homemadeEngine = new HomemadeSearchEngine(DOCUMENTS);
  const tInitMs = (performance.now() - tInit0).toFixed(2);
  console.log(
    `    Indexed ${homemadeEngine.index.totalDocs} docs ` +
      `(${homemadeEngine.index.vocabularySize} unique terms) in ${tInitMs}ms.`
  );

  console.log("[*] Checking Elasticsearch connectivity on http://localhost:9200...");
  const esClient = new ElasticsearchClient();
  let esAvailable = false;
  try {
    esAvailable = await esClient.ping();
    if (esAvailable) {
      console.log("    Connected to Elasticsearch successfully.");
      await esClient.createIndex(true);
      await esClient.indexCorpus(DOCUMENTS);
    } else {
      console.log("    [NOTICE] Elasticsearch is not responding. Running Handcrafted Engine only.");
      console.log("             (Run 'docker compose up -d' to enable the full comparative evaluation).");
    }
  } catch (err) {
    console.log(`    [NOTICE] Could not connect to Elasticsearch: ${err.message}`);
    console.log("             (Run 'docker compose up -d' to enable the full comparative evaluation).");
  }

  const configs = [
    {
      key: "homemade_bm25",
      name: "Handcrafted (Boolean AND + BM25)",
      run: (q) => homemadeEngine.search(q, { topK: 10 }),
    },
  ];

  if (esAvailable) {
    configs.push(
      {
        key: "es_standard",
        name: "Elasticsearch (Standard Analyzer, OR)",
        run: (q) => esClient.search(q, "content", "or", 10),
      },
      {
        key: "es_english",
        name: "Elasticsearch (English Analyzer + Stemming, OR)",
        run: (q) => esClient.search(q, "content.english", "or", 10),
      },
      {
        key: "es_exact",
        name: "Elasticsearch (Exact Hyphen Analyzer, OR)",
        run: (q) => esClient.search(q, "content.exact", "or", 10),
      }
    );
  }

  const detailedResults = [];
  const engineStats = new Map();
  for (const cfg of configs) {
    engineStats.set(cfg.key, { latencies: [], metrics: [] });
  }

  console.log("\n==========================================================================================");
  console.log("  EXECUTING THE 3 vs 3 BENCHMARK COMPARISON SUITE");
  console.log("==========================================================================================");

  const outputLog = [];

  for (const item of BENCHMARK_QUERIES) {
    const banner = [
      `\n>>> [Query ${item.id}] "${item.query}"`,
      `    Category:  ${item.category}`,
      `    Rationale: ${item.rationale}`,
    ].join("\n");
    console.log(banner);
    outputLog.push(banner);

    const relevantDocs = evaluator.getRelevantDocs(item.query);
    const relevantStr = Array.from(relevantDocs).sort((a, b) => a - b).join(", ");
    console.log(`    Ground-Truth Relevant Docs: [${relevantStr}]`);
    outputLog.push(`    Ground-Truth Relevant Docs: [${relevantStr}]`);

    const queryRecord = {
      id: item.id,
      query: item.query,
      category: item.category,
      configs: {},
    };

    for (const cfg of configs) {
      // Warmup pass
      await cfg.run(item.query);

      // Timed execution (10 iterations for microsecond stability)
      const runs = 10;
      const t0 = performance.now();
      let lastHits = [];
      for (let i = 0; i < runs; i++) {
        lastHits = await cfg.run(item.query);
      }
      const latencyMs = (performance.now() - t0) / runs;

      const retrievedDocIds = lastHits.map((h) => h.doc_id);
      const metrics = evaluator.evaluateRetrieval(item.query, retrievedDocIds, [1, 3, 5]);

      engineStats.get(cfg.key).latencies.push(latencyMs);
      engineStats.get(cfg.key).metrics.push(metrics);

      queryRecord.configs[cfg.key] = {
        latencyMs: Math.round(latencyMs * 100) / 100,
        hits: lastHits,
        metrics,
      };

      const hitsSummary =
        lastHits.length > 0
          ? lastHits
              .slice(0, 3)
              .map((h) => `Doc ${h.doc_id}(s=${h.score})`)
              .join(", ")
          : "0 hits (Boolean AND miss)";

      const line =
        `    ${cfg.name.padEnd(46)} | ` +
        `Latency: ${latencyMs.toFixed(2).padStart(6)}ms | ` +
        `P@1: ${metrics["precision@1"].toFixed(2)} | ` +
        `R@3: ${metrics["recall@3"].toFixed(2)} | ` +
        `AP: ${metrics.averagePrecision.toFixed(2)} | ` +
        `Hits: [${hitsSummary}]`;

      console.log(line);
      outputLog.push(line);
    }

    detailedResults.push(queryRecord);
  }

  // Print Aggregated Scorecard
  console.log("\n==========================================================================================");
  console.log("  FINAL AGGREGATED BENCHMARK SCORECARD (6 BENCHMARK QUERIES)");
  console.log("==========================================================================================");
  const header =
    "Engine Configuration                             | Mean Latency | P@1      | P@3      | R@3      | MAP      | MRR     ";
  const divider =
    "------------------------------------------------------------------------------------------";
  console.log(header);
  console.log(divider);
  outputLog.push("\n" + header);
  outputLog.push(divider);

  const summaryData = [];

  for (const cfg of configs) {
    const stats = engineStats.get(cfg.key);
    const agg = evaluator.aggregateSuite(stats.metrics);
    const meanLat = stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length;

    const p1 = agg["mean_precision@1"] ?? 0;
    const p3 = agg["mean_precision@3"] ?? 0;
    const r3 = agg["mean_recall@3"] ?? 0;
    const mapVal = agg.meanAveragePrecision ?? 0;
    const mrrVal = agg.meanReciprocalRank ?? 0;

    const row =
      `${cfg.name.padEnd(48)} | ` +
      `${meanLat.toFixed(2).padStart(5)} ms   | ` +
      `${p1.toFixed(4)}   | ` +
      `${p3.toFixed(4)}   | ` +
      `${r3.toFixed(4)}   | ` +
      `${mapVal.toFixed(4)}   | ` +
      `${mrrVal.toFixed(4)}  `;

    console.log(row);
    outputLog.push(row);

    summaryData.push({
      engine: cfg.name,
      key: cfg.key,
      meanLatencyMs: Math.round(meanLat * 100) / 100,
      pAt1: p1,
      pAt3: p3,
      rAt3: r3,
      map: mapVal,
      mrr: mrrVal,
    });
  }
  console.log(divider);
  outputLog.push(divider);

  // Deep Dive BM25 Scoring Explain Comparison for Query B3
  console.log("\n==========================================================================================");
  console.log("  DEEP DIVE: BM25 SCORING EXPLAIN COMPARISON (Query: 'raft consensus leader election')");
  console.log("==========================================================================================");

  const explainDocId = 2;
  const explainQuery = "raft consensus leader election";
  const hmExplain = homemadeEngine.explain(explainQuery, explainDocId);

  console.log(`--- Handcrafted Inverted Index BM25 Calculation (Doc ${explainDocId}) ---`);
  console.log(`  Total BM25 Score: ${hmExplain.bm25Score.toFixed(4)} (Doc Length: ${hmExplain.docLen}, AvgDL: ${hmExplain.avgLen})`);
  for (const t of hmExplain.terms) {
    console.log(
      `    * Term '${t.term.padEnd(10)}' | TF=${t.tf} | IDF=${t.idf.toFixed(4)} | ` +
        `TF_Norm=${t.tfNorm.toFixed(4)} | BM25 Contribution=${t.bm25Contribution.toFixed(4)}`
    );
  }

  if (esAvailable) {
    try {
      const esExplain = await esClient.explain(explainQuery, explainDocId, "content.english");
      console.log(`\n--- Elasticsearch Lucene BM25 Calculation (Doc ${explainDocId}, field: content.english) ---`);
      const explanation = esExplain.explanation;
      console.log(`  Total BM25 Score: ${explanation.value.toFixed(4)}`);
      console.log(`  Top-level description: ${explanation.description}`);
      if (explanation.details && explanation.details.length > 0) {
        for (const detail of explanation.details) {
          console.log(`    - ${detail.description}: score=${detail.value.toFixed(4)}`);
        }
      }
    } catch (err) {
      console.log(`    (Could not fetch ES explain: ${err.message})`);
    }
  }

  console.log("==========================================================================================");

  // Write outputs to disk for inspection
  const reportPath = path.join(__dirname, "benchmark_results.json");
  const logPath = path.join(__dirname, "benchmark_scorecard.txt");
  fs.writeFileSync(reportPath, JSON.stringify({ summary: summaryData, queries: detailedResults }, null, 2));
  fs.writeFileSync(logPath, outputLog.join("\n"));
  console.log(`[*] Benchmark report written to: ${reportPath}`);
  console.log(`[*] Benchmark scorecard log written to: ${logPath}`);
}

runBenchmark().catch((err) => {
  console.error("[FATAL ERROR]", err);
  process.exit(1);
});
