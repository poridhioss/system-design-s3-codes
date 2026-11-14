/**
 * server.js - Unified Search Surface Gateway (Express.js)
 *
 * Production HTTP gateway exposing:
 *   - Sub-millisecond keystroke autocomplete (/suggest) powered by Trie (Lab 8)
 *   - Resilient full-text search with circuit breaker fallback (/search) (Labs 9 + 7 + 6)
 *   - Side-by-side performance comparison (/compare)
 *   - Circuit breaker chaos administration (/circuit-breaker/trip, /reset)
 *   - System telemetry and health (/health)
 *   - Interactive split-screen visual dashboard (/)
 */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { QUERY_DATASET } from './dataset.js';
import { TrieService } from './TrieService.js';
import { SearchBroker } from './SearchBroker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// 1. Initialize Autocomplete Trie Service (from Lab 8)
const trieService = new TrieService(5);
trieService.buildFromDataset(QUERY_DATASET);
console.log(`[INIT] Trie autocomplete initialized with ${QUERY_DATASET.length} seed terms.`);

// 2. Initialize Search Broker with Circuit Breaker (from Labs 6, 7, 9)
const searchBroker = new SearchBroker();
console.log('[INIT] Search Broker initialized with Circuit Breaker and In-Memory Index.');

// 3. Serve Static Dashboard Assets
const staticDir = path.join(__dirname, 'static');
app.use('/static', express.static(staticDir));

app.get('/', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

/**
 * GET /suggest?q={prefix}&limit={n}
 *
 * Sub-millisecond keystroke typeahead autocomplete.
 * Evaluates in-memory Trie with precomputed Top-K node heaps in 0.02ms.
 * Enforces 2-character prefix gate to protect RAM from single-letter cache churn.
 */
app.get('/suggest', (req, res) => {
  const prefix = req.query.q || '';
  const limit = parseInt(req.query.limit, 10) || 5;
  const cleanPrefix = String(prefix).trim().toLowerCase();

  // Prefix Gating: Reject single-character queries at the gateway boundary
  if (cleanPrefix.length < 2) {
    return res.json({
      query: cleanPrefix,
      suggestions: [],
      total_hits: 0,
      latency_ms: 0.001,
      gated: true,
      message: 'Prefix length must be at least 2 characters.',
    });
  }

  const t0 = performance.now();
  const suggestions = trieService.suggest(cleanPrefix, limit);
  const latencyMs = performance.now() - t0;

  return res.json({
    query: cleanPrefix,
    suggestions,
    total_hits: suggestions.length,
    latency_ms: Math.round(latencyMs * 1000) / 1000,
    engine: 'trie',
    gated: false,
  });
});

/**
 * GET /search?q={query}&force_fallback={bool}
 *
 * Fault-tolerant search execution route.
 * Routes to primary Elasticsearch when healthy (status 200).
 * Instantly degrades to in-memory Inverted Index in 0.04ms when circuit trips or times out.
 */
app.get('/search', async (req, res) => {
  const query = req.query.q;
  const forceFallback = req.query.force_fallback === 'true' || req.query.force_fallback === '1';

  if (!query || !String(query).trim()) {
    return res.status(400).json({ error: 'Query parameter "q" cannot be empty.' });
  }

  try {
    const searchResult = await searchBroker.search(String(query).trim(), {
      topK: 10,
      forceFallback,
    });
    return res.json(searchResult);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /compare?q={query}
 *
 * Side-by-side performance comparison route.
 * Executes query concurrently against Elasticsearch and in-memory Inverted Index
 * to demonstrate the latency vs. word stemming recall trade-off.
 */
app.get('/compare', async (req, res) => {
  const query = req.query.q;
  if (!query || !String(query).trim()) {
    return res.status(400).json({ error: 'Query parameter "q" cannot be empty.' });
  }

  const cleanQ = String(query).trim();

  // 1. Primary: Elasticsearch
  const t0Es = performance.now();
  let esReachable = true;
  let esError = null;
  let esHits = [];

  try {
    esHits = await searchBroker.esClient.search({
      query: cleanQ,
      field: 'content.english',
      topK: 5,
    });
  } catch (exc) {
    esReachable = false;
    esError = exc.message;
  }
  const esLatencyMs = Math.round((performance.now() - t0Es) * 1000) / 1000;

  // 2. Fallback: In-Memory Inverted Index
  const t0Ram = performance.now();
  const ramHits = searchBroker.fallbackSearch(cleanQ, 5);
  const ramLatencyMs = Math.round((performance.now() - t0Ram) * 1000) / 1000;

  const speedupFactor = esReachable
    ? Math.round((esLatencyMs / Math.max(0.001, ramLatencyMs)) * 10) / 10
    : null;

  return res.json({
    query: cleanQ,
    elasticsearch: {
      reachable: esReachable,
      latency_ms: esLatencyMs,
      total_hits: esHits.length,
      hits: esHits,
      error: esError,
    },
    in_memory_inverted_index: {
      latency_ms: ramLatencyMs,
      total_hits: ramHits.length,
      hits: ramHits,
    },
    speedup_factor: speedupFactor,
  });
});

/**
 * GET /health
 *
 * Telemetry endpoint providing real-time circuit breaker and cluster diagnostics.
 */
app.get('/health', async (req, res) => {
  const esReachable = await searchBroker.esClient.ping();
  const cbStatus = searchBroker.circuitBreaker.getStatus();

  return res.json({
    status: 'healthy',
    primary_elasticsearch: {
      reachable: esReachable,
      cluster_status: esReachable ? 'green' : 'offline',
    },
    circuit_breaker: {
      state: cbStatus.state,
      failure_count: cbStatus.failures,
      failure_threshold: 3,
      timeout_sla_ms: searchBroker.circuitBreaker.timeoutSlaMs,
      cooldown_remaining_s: Math.ceil(cbStatus.cooldownRemainingMs / 1000),
    },
  });
});

/**
 * POST /circuit-breaker/trip
 *
 * Chaos Engineering administration: Forces circuit breaker into OPEN state.
 */
app.post('/circuit-breaker/trip', (req, res) => {
  searchBroker.circuitBreaker.trip('Manual chaos engineering drill');
  console.log('[CHAOS] Circuit breaker forced OPEN via administration API.');
  return res.json({
    status: 'tripped',
    circuit_breaker: searchBroker.circuitBreaker.getStatus(),
  });
});

/**
 * POST /circuit-breaker/reset
 *
 * Chaos Engineering administration: Resets circuit breaker to CLOSED state.
 */
app.post('/circuit-breaker/reset', (req, res) => {
  searchBroker.circuitBreaker.reset();
  console.log('[CHAOS] Circuit breaker reset to CLOSED via administration API.');
  return res.json({
    status: 'reset',
    circuit_breaker: searchBroker.circuitBreaker.getStatus(),
  });
});

// Start Server if run directly
if (process.argv[1]?.endsWith('server.js')) {
  app.listen(PORT, () => {
    console.log('================================================================');
    console.log(`  Unified Search Gateway running on http://localhost:${PORT}`);
    console.log('================================================================');
  });
}

export { app, searchBroker, trieService };
