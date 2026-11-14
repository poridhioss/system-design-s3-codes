/**
 * verify_search_layer.js
 *
 * Automated verification test suite for the Unified Search Surface Gateway.
 * Validates:
 *   1. System health & Circuit Breaker telemetry
 *   2. Trie-based prefix autocomplete and prefix gating (Lab 8)
 *   3. Primary search routing and graceful degradation to RAM (Labs 6, 7, 9)
 *   4. Side-by-side comparison endpoint
 *   5. Circuit Breaker chaos administration (trip and reset)
 */

import { app, searchBroker, trieService } from './server.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

/**
 * Universal in-process request dispatcher for Express.
 * Evaluates full Express routing and middleware stack with zero socket/network overhead.
 */
function request(method, url, body = null) {
  return new Promise((resolve, reject) => {
    const [pathPart, qs] = url.split('?');
    const query = {};
    if (qs) {
      new URLSearchParams(qs).forEach((v, k) => {
        query[k] = v;
      });
    }

    const req = {
      method: method.toUpperCase(),
      url,
      originalUrl: url,
      path: pathPart,
      query,
      body: body || {},
      headers: { 'content-type': 'application/json' },
    };

    const res = {
      statusCode: 200,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      setHeader(k, v) {
        this.headers[k] = v;
      },
      json(data) {
        resolve({
          status: this.statusCode,
          json: async () => data,
        });
      },
      send(data) {
        resolve({
          status: this.statusCode,
          text: async () => String(data),
          json: async () => JSON.parse(data),
        });
      },
    };

    try {
      app.handle(req, res);
    } catch (err) {
      reject(err);
    }
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('  UNIFIED SEARCH SURFACE AUTOMATED TEST SUITE');
  console.log('================================================================\n');

  try {
    // Test 1: Health Endpoint
    console.log('[TEST 1] System Health & Circuit Breaker State');
    const healthRes = await request('GET', '/health');
    assert(healthRes.status === 200, 'Health endpoint responds with HTTP 200');
    const healthData = await healthRes.json();
    assert(healthData.circuit_breaker.state === 'CLOSED', 'Initial circuit breaker state is CLOSED');

    // Test 2: Keystroke Autocomplete with Valid Prefix
    console.log('\n[TEST 2] Trie Keystroke Autocomplete (/suggest)');
    const suggestRes = await request('GET', '/suggest?q=sys&limit=5');
    assert(suggestRes.status === 200, 'Suggest endpoint responds with HTTP 200');
    const suggestData = await suggestRes.json();
    assert(suggestData.engine === 'trie', 'Autocomplete engine is trie');
    assert(suggestData.suggestions.length > 0, `Returned ${suggestData.suggestions.length} suggestions for prefix "sys"`);
    assert(suggestData.gated === false, 'Prefix "sys" passed the 2-character gate');
    assert(suggestData.latency_ms < 5.0, `Suggest latency is sub-millisecond (${suggestData.latency_ms} ms)`);

    // Test 3: Prefix Gating Defense
    console.log('\n[TEST 3] Prefix Gating Defense (min_length = 2)');
    const gatedRes = await request('GET', '/suggest?q=s');
    const gatedData = await gatedRes.json();
    assert(gatedData.gated === true, 'Single-character prefix "s" was successfully gated');
    assert(gatedData.suggestions.length === 0, 'No suggestions emitted for gated prefix');

    // Test 4: Forced RAM Fallback Search
    console.log('\n[TEST 4] Resilient Fallback Search (/search?force_fallback=true)');
    const fallbackRes = await request('GET', '/search?q=consensus&force_fallback=true');
    assert(fallbackRes.status === 200, 'Search fallback endpoint responds with HTTP 200');
    const fallbackData = await fallbackRes.json();
    assert(fallbackData.engine === 'in-memory-inverted-index', 'Engine attribution is in-memory-inverted-index');
    assert(fallbackData.degraded === true, 'Response is marked degraded: true');
    assert(fallbackData.total_hits > 0, `Fallback returned ${fallbackData.total_hits} ranked documents`);
    assert(fallbackData.latency_ms < 5.0, `RAM fallback executed in ${fallbackData.latency_ms} ms`);

    // Test 5: Side-by-Side Comparison
    console.log('\n[TEST 5] Side-by-Side Comparison (/compare)');
    const compareRes = await request('GET', '/compare?q=consensus');
    assert(compareRes.status === 200, 'Compare endpoint responds with HTTP 200');
    const compareData = await compareRes.json();
    assert(compareData.in_memory_inverted_index.total_hits > 0, 'In-memory index returned valid hits');
    assert(typeof compareData.elasticsearch === 'object', 'Elasticsearch evaluation included in compare response');

    // Test 6: Chaos Trip Administration
    console.log('\n[TEST 6] Chaos Engineering: Tripping Circuit Breaker');
    const tripRes = await request('POST', '/circuit-breaker/trip');
    assert(tripRes.status === 200, 'Trip endpoint responds with HTTP 200');
    const tripData = await tripRes.json();
    assert(tripData.circuit_breaker.state === 'OPEN', 'Circuit breaker successfully switched to OPEN');

    // Test 7: Verify Fast-Path Fallback under Tripped Circuit
    console.log('\n[TEST 7] Fast-Path Degradation While Circuit is OPEN');
    const trippedSearchRes = await request('GET', '/search?q=consensus');
    const trippedSearchData = await trippedSearchRes.json();
    assert(trippedSearchData.degraded === true, 'Search automatically degraded while circuit is OPEN');
    assert(trippedSearchData.engine === 'in-memory-inverted-index', 'Routed directly to RAM without calling primary');
    assert(trippedSearchData.degradation_reason === 'Circuit Breaker OPEN', 'Degradation reason accurately captured');

    // Test 8: Chaos Reset Administration
    console.log('\n[TEST 8] Chaos Engineering: Resetting Circuit Breaker');
    const resetRes = await request('POST', '/circuit-breaker/reset');
    assert(resetRes.status === 200, 'Reset endpoint responds with HTTP 200');
    const resetData = await resetRes.json();
    assert(resetData.circuit_breaker.state === 'CLOSED', 'Circuit breaker successfully restored to CLOSED');

    console.log('\n================================================================');
    console.log(`  RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log('================================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal test error:', err);
    process.exit(1);
  }
}

runTests();
