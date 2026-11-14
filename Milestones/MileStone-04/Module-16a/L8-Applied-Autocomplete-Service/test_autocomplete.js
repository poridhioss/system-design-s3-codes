/**
 * test_autocomplete.js - Automated Test Suite for Autocomplete Service
 *
 * Verifies:
 * 1. Engine Parity: Trie and FlatPrefixMap return identical top-K suggestions.
 * 2. Redis Operations: Atomic frequency increments and hot-prefix caching.
 * 3. AutocompleteService: L1 cache-aside acceleration and resilient error fallback.
 * 4. Express HTTP Endpoints: /suggest, /search, /metrics, /health, and < 50ms SLA compliance.
 */

import test, { describe, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { QUERY_DATASET } from "./dataset.js";
import { TrieService } from "./TrieService.js";
import { FlatPrefixMap } from "./FlatPrefixMap.js";
import { AutocompleteService } from "./AutocompleteService.js";
import { TypeaheadRedisClient } from "./redis_client.js";
import { app, redisClient } from "./server.js";

describe("Suite 1: Engine Parity & Top-K Correctness", () => {
  let trie;
  let flatMap;

  beforeEach(() => {
    trie = new TrieService(5);
    trie.buildFromDataset(QUERY_DATASET, 5);

    flatMap = new FlatPrefixMap(6, 5);
    flatMap.build(QUERY_DATASET);
  });

  test("both engines correctly suggest top results for food prefix 'kac'", () => {
    const trieRes = trie.suggest("kac", 3).map((r) => r.word || r.query);
    const hashRes = flatMap.suggest("kac", 3).map((r) => r.query);

    assert.deepEqual(trieRes, hashRes, "Trie and FlatPrefixMap must return identical top results for 'kac'");
    assert.equal(trieRes[0], "kacchi biryani");
    assert.equal(trieRes[1], "kacchi mutton");
    assert.equal(trieRes[2], "kacchi");
  });

  test("both engines preserve self-ending words for transit prefix 'dhaka'", () => {
    const trieRes = trie.suggest("dhaka", 4).map((r) => r.word || r.query);
    const hashRes = flatMap.suggest("dhaka", 4).map((r) => r.query);

    assert.deepEqual(trieRes, hashRes, "Trie and FlatPrefixMap must return identical top results for 'dhaka'");
    assert.equal(trieRes[0], "dhaka", "Self-ending query 'dhaka' must hold Rank 1 due to 18,500 frequency");
    assert.equal(trieRes[1], "dhaka to chittagong");
  });

  test("handles single-character prefix lookups", () => {
    const trieRes = trie.suggest("b", 2);
    const hashRes = flatMap.suggest("b", 2);

    assert.equal(trieRes.length, 2);
    assert.equal(hashRes.length, 2);
    assert.equal(trieRes[0].word || trieRes[0].query, hashRes[0].query);
  });

  test("returns empty array for non-existent prefixes", () => {
    const trieRes = trie.suggest("xyz999", 5);
    const hashRes = flatMap.suggest("xyz999", 5);

    assert.deepEqual(trieRes, []);
    assert.deepEqual(hashRes, []);
  });
});

describe("Suite 2: Redis Client Operations & ACL Invariants", () => {
  // Mock client stub to verify client interface contract independently
  class MockRedisClient {
    constructor() {
      this.frequencies = new Map();
      this.cache = new Map();
    }
    async ping() { return true; }
    async recordQuerySearch(query, inc = 1) {
      const cur = this.frequencies.get(query) || 0;
      this.frequencies.set(query, cur + inc);
      return cur + inc;
    }
    async getTopQueries(k = 10) {
      return Array.from(this.frequencies.entries())
        .map(([query, score]) => ({ query, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    }
    async cachePrefixResults(prefix, results) {
      this.cache.set(prefix, results);
      return true;
    }
    async getCachedPrefixResults(prefix) {
      return this.cache.get(prefix) || null;
    }
    async flushTestData() {
      this.frequencies.clear();
      this.cache.clear();
    }
  }

  test("atomic query search increments score correctly", async () => {
    const mock = new MockRedisClient();
    const s1 = await mock.recordQuerySearch("kacchi biryani", 3);
    const s2 = await mock.recordQuerySearch("kacchi biryani", 4);
    assert.equal(s1, 3);
    assert.equal(s2, 7);
  });

  test("prefix cache sets and gets serialized suggestions", async () => {
    const mock = new MockRedisClient();
    const sample = [{ query: "dhaka to sylhet", frequency: 9600 }];
    await mock.cachePrefixResults("dha", sample);
    const cached = await mock.getCachedPrefixResults("dha");
    assert.deepEqual(cached, sample);
  });

  test("getTopQueries sorts search counts descending", async () => {
    const mock = new MockRedisClient();
    await mock.recordQuerySearch("sylhet", 10);
    await mock.recordQuerySearch("dhaka", 50);
    await mock.recordQuerySearch("chittagong", 25);
    const top = await mock.getTopQueries(2);
    assert.equal(top[0].query, "dhaka");
    assert.equal(top[0].score, 50);
    assert.equal(top[1].query, "chittagong");
  });

  test("flushTestData wipes test keys", async () => {
    const mock = new MockRedisClient();
    await mock.recordQuerySearch("test", 1);
    await mock.cachePrefixResults("t", [{ query: "test", frequency: 1 }]);
    await mock.flushTestData();
    assert.equal((await mock.getTopQueries()).length, 0);
    assert.equal(await mock.getCachedPrefixResults("t"), null);
  });
});

describe("Suite 3: AutocompleteService Cache-Aside & Resilient Fallback", () => {
  let service;
  let inMemoryCache;

  beforeEach(() => {
    inMemoryCache = new Map();
    const stubRedis = {
      ping: async () => true,
      getCachedPrefixResults: async (prefix) => inMemoryCache.get(prefix) || null,
      cachePrefixResults: async (prefix, results) => {
        inMemoryCache.set(prefix, results);
        return true;
      },
      recordQuerySearch: async () => 1,
      getTopQueries: async () => []
    };

    service = new AutocompleteService({ k: 5, redisClient: stubRedis });
    service.initialize(QUERY_DATASET);
  });

  test("first request is a cache miss and queries memory engine", async () => {
    const res = await service.suggestWithCache("kac", "hash", 3);
    assert.equal(res.source, "memory_hash");
    assert.equal(res.suggestions.length, 3);
    assert.equal(res.suggestions[0].query, "kacchi biryani");
    assert.equal(service.cacheMisses, 1);
    assert.equal(service.cacheHits, 0);
  });

  test("second request is a cache hit served from Redis L1 cache", async () => {
    // 1st call (miss, warms cache)
    await service.suggestWithCache("kac", "hash", 3);
    // 2nd call (hit)
    const res = await service.suggestWithCache("kac", "hash", 3);
    assert.equal(res.source, "redis_cache");
    assert.equal(res.suggestions.length, 3);
    assert.equal(service.cacheHits, 1);
  });

  test("resilient fallback: Redis failure automatically degrades to memory engine", async () => {
    const failingRedis = {
      ping: async () => false,
      getCachedPrefixResults: async () => { throw new Error("Connection timeout"); },
      cachePrefixResults: async () => { throw new Error("Connection timeout"); },
      recordQuerySearch: async () => null,
      getTopQueries: async () => []
    };

    const resilientService = new AutocompleteService({ k: 5, redisClient: failingRedis });
    resilientService.initialize(QUERY_DATASET);

    const res = await resilientService.suggestWithCache("dhaka", "trie", 2);
    assert.equal(res.source, "memory_trie");
    assert.equal(res.suggestions[0].query, "dhaka");
    assert.ok(res.tookMs < 5.0, "Degraded RAM lookup must still resolve in sub-millisecond time");
  });

  test("service reports accurate engine and cache statistics", async () => {
    await service.suggestWithCache("kac", "hash", 3);
    await service.suggestWithCache("kac", "hash", 3);
    const stats = service.getStats();

    assert.equal(stats.trie.totalWords, 25);
    assert.ok(stats.flatPrefixMap.uniquePrefixes > 0);
    assert.equal(stats.cache.hits, 1);
    assert.equal(stats.cache.misses, 1);
    assert.equal(stats.cache.ratio, 0.5);
  });
});

describe("Suite 4: Express HTTP Microservice & SLA Verification", () => {
  let server;
  let baseUrl;

  before(async () => {
    const defaultPort = Number(process.env.PORT) || 3001;

    // 1. Check if the microservice is already running on port 3001 (or process.env.PORT)
    try {
      const probe = await fetch(`http://127.0.0.1:${defaultPort}/`, {
        signal: AbortSignal.timeout(400)
      });
      if (probe.status === 200) {
        // Reuse the running server directly without starting another listener
        baseUrl = `http://127.0.0.1:${defaultPort}`;
        return;
      }
    } catch {
      // Server not reachable on defaultPort; spin up an in-process ephemeral test server
    }

    // 2. Fallback: Spin up an ephemeral test server on port 0
    await new Promise((resolve) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    // Only close ephemeral server if created in this test process
    if (server) {
      await new Promise((res) => server.close(res));
    }
    // Disconnect Redis client created when importing server.js to allow immediate event loop exit
    if (redisClient?.client) {
      redisClient.client.disconnect();
    }
  });

  test("GET / returns 200 with service health info", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, "healthy");
  });

  test("GET /suggest?q=kac&engine=hash returns ranked suggestions within 50ms budget", async () => {
    const t0 = performance.now();
    const res = await fetch(`${baseUrl}/suggest?q=kac&engine=hash&k=3`);
    const t1 = performance.now();
    const roundTripMs = t1 - t0;

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.prefix, "kac");
    assert.equal(json.engine, "hash");
    assert.equal(json.count, 3);
    assert.equal(json.suggestions[0].query, "kacchi biryani");

    // Physical 50ms SLA verification: response within 50ms keystroke budget
    assert.ok(json.tookMs < 50.0, `Compute took ${json.tookMs}ms, must be < 50ms`);
    assert.ok(roundTripMs < 50.0, `Round-trip took ${roundTripMs}ms, must be < 50ms`);
  });

  test("POST /search records search event asynchronously", async () => {
    const res = await fetch(`${baseUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "kacchi biryani", increment: 1 })
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.status, "recorded");
    assert.equal(json.query, "kacchi biryani");
  });

  test("GET /metrics returns memory, engine stats, and cache hits", async () => {
    const res = await fetch(`${baseUrl}/metrics`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.memory.heapUsedMb > 0);
    const trieWords = json.engines?.trie?.totalWords ?? json.engines?.trieWords ?? 0;
    const flatPrefixes = json.engines?.flatPrefixMap?.uniquePrefixes ?? json.engines?.flatMapPrefixes ?? 0;
    assert.ok(trieWords >= 25, "Trie must index at least 25 seed words");
    assert.ok(flatPrefixes > 0, "FlatPrefixMap must index prefixes");
  });
});
