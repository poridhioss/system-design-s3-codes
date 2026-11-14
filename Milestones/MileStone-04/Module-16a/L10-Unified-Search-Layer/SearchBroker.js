/**
 * SearchBroker.js - Unified Search Query Broker with Resilient Fallback
 *
 * Coordinates query execution between the primary full-text engine (Elasticsearch)
 * and the embedded in-memory fallback engine (Inverted Index from Lab 7).
 * Protected by the CircuitBreaker (from Lab 6) to enforce sub-millisecond degradation
 * whenever the primary cluster experiences outages, slowdowns, or SLA breaches.
 */

import { performance } from 'node:perf_hooks';
import { DOCUMENTS } from './corpus.js';
import { TextAnalyzer } from './TextAnalyzer.js';
import { InvertedIndex } from './InvertedIndex.js';
import { SearchRanker } from './SearchRanker.js';
import { ElasticsearchClient } from './esClient.js';
import { CircuitBreaker } from './CircuitBreaker.js';

export class SearchBroker {
  /**
   * @param {Object} [options]
   * @param {ElasticsearchClient} [options.esClient]
   * @param {CircuitBreaker} [options.circuitBreaker]
   */
  constructor(options = {}) {
    // 1. Primary Engine: Elasticsearch Client (from Lab 9)
    this.esClient = options.esClient || new ElasticsearchClient();

    // 2. In-Memory Fallback Engine: Inverted Index & BM25 Ranker (from Lab 7)
    this.analyzer = new TextAnalyzer();
    this.index = new InvertedIndex();
    for (const [docId, doc] of Object.entries(DOCUMENTS)) {
      const tokens = this.analyzer.analyze(doc.content);
      this.index.addDocument(Number(docId), tokens);
    }
    this.ranker = new SearchRanker(this.index, this.analyzer);

    // 3. Fault-Tolerance Guard: Circuit Breaker FSM (from Lab 6)
    this.circuitBreaker = options.circuitBreaker || new CircuitBreaker({
      failureThreshold: 0.50,
      minRequests: 3,
      recoveryTimeoutMs: 10000,
      timeoutSlaMs: 500,
    });
  }

  /**
   * Fallback search against the in-memory Inverted Index.
   * Runs directly in Node.js process RAM in ~0.04ms with zero network hops.
   *
   * @param {string} query - The search query string.
   * @param {number} [topK=10] - Maximum documents to return.
   * @returns {Array<{ doc_id: number, score: number, title: string }>}
   */
  fallbackSearch(query, topK = 10) {
    // TODO 1: Implement Fallback Execution against In-Memory Inverted Index
    // 1. Validate that query is non-empty after trimming. Return [] if empty.
    // 2. Query this.ranker using BM25 scoring mode.
    // 3. Map resulting hits to { doc_id, score, title } using DOCUMENTS metadata.
    if (!query || !query.trim()) {
      return [];
    }

    try {
      const rawResults = this.ranker.search(query.trim(), { mode: 'bm25', topK });
      return rawResults.map((hit) => {
        const docId = hit.docId !== undefined ? hit.docId : hit[0];
        const score = hit.score !== undefined ? hit.score : hit[1];
        return {
          doc_id: Number(docId),
          score: Math.round(Number(score) * 10000) / 10000,
          title: DOCUMENTS[docId]?.title || `Document #${docId}`,
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Executes search with Circuit Breaker protection and graceful degradation.
   *
   * @param {string} query - User search string.
   * @param {Object} [options]
   * @param {number} [options.topK=10] - Number of ranked hits.
   * @param {boolean} [options.forceFallback=false] - Administrative drill override.
   * @returns {Promise<Object>} Search result envelope with engine attribution & telemetry.
   */
  async search(query, options = {}) {
    const topK = options.topK || 10;
    const forceFallback = options.forceFallback || false;
    const startTime = performance.now();

    // Fast-path degradation: Bypass primary if circuit is OPEN or fallback forced
    if (forceFallback || !this.circuitBreaker.canExecute()) {
      const hits = this.fallbackSearch(query, topK);
      const latencyMs = performance.now() - startTime;

      return {
        query,
        engine: 'in-memory-inverted-index',
        degraded: true,
        latency_ms: Math.round(latencyMs * 1000) / 1000,
        total_hits: hits.length,
        results: hits,
        circuit_breaker: this.circuitBreaker.getStatus(),
        degradation_reason: forceFallback ? 'Administrative override' : 'Circuit Breaker OPEN',
      };
    }

    // Primary path: Query Elasticsearch Cluster under Circuit Breaker guard
    try {
      const hits = await this.circuitBreaker.execute(async () => {
        const t0 = performance.now();
        const rawHits = await this.esClient.search({
          query,
          field: 'content.english',
          topK,
        });
        const duration = performance.now() - t0;

        // TODO 2: Enforce the 500ms Timeout SLA
        // If the primary query execution exceeds timeoutSlaMs, throw an error
        // to record the failure on the circuit breaker and trigger fallback.
        if (duration > this.circuitBreaker.timeoutSlaMs) {
          throw new Error(`Elasticsearch latency ${duration.toFixed(1)}ms breached SLA of ${this.circuitBreaker.timeoutSlaMs}ms`);
        }

        return rawHits;
      });

      const latencyMs = performance.now() - startTime;
      return {
        query,
        engine: 'elasticsearch',
        degraded: false,
        latency_ms: Math.round(latencyMs * 1000) / 1000,
        total_hits: hits.length,
        results: hits,
        circuit_breaker: this.circuitBreaker.getStatus(),
        degradation_reason: null,
      };
    } catch (err) {
      // Primary failed (cluster down, connection refused, 503, SLA timeout)
      const hits = this.fallbackSearch(query, topK);
      const latencyMs = performance.now() - startTime;

      return {
        query,
        engine: 'in-memory-inverted-index',
        degraded: true,
        latency_ms: Math.round(latencyMs * 1000) / 1000,
        total_hits: hits.length,
        results: hits,
        circuit_breaker: this.circuitBreaker.getStatus(),
        degradation_reason: err.message || 'Primary failure',
      };
    }
  }
}

// Direct CLI test if executed directly
if (process.argv[1]?.endsWith('SearchBroker.js')) {
  console.log('=== Testing SearchBroker Graceful Degradation ===');
  const broker = new SearchBroker();

  // Test isolated in-memory fallback
  const fallbackRes = await broker.search('distributed consensus', { forceFallback: true });
  console.log(`Fallback Search Result: engine=${fallbackRes.engine}, degraded=${fallbackRes.degraded}`);
  console.log(`  Latency: ${fallbackRes.latency_ms} ms | Total Hits: ${fallbackRes.total_hits}`);
  for (const hit of fallbackRes.results) {
    console.log(`    - Doc #${hit.doc_id}: ${hit.title} (score: ${hit.score})`);
  }

  if (fallbackRes.engine === 'in-memory-inverted-index' && fallbackRes.degraded === true && fallbackRes.total_hits > 0) {
    console.log('\n[PASS] SearchBroker fallback execution verified successfully!');
  } else {
    console.error('\n[FAIL] SearchBroker verification failed.');
    process.exit(1);
  }
}
