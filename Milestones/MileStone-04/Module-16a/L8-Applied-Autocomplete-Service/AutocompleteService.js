/**
 * AutocompleteService.js - Multi-Engine Autocomplete Coordinator with L1 Cache-Aside
 *
 * Unites the Character Trie (from Lab 3) and FlatPrefixMap (from Lab 4)
 * with Poridhi Cloud Redis L1 hot-prefix caching and resilient fallback.
 */

import { TrieService } from "./TrieService.js";
import { FlatPrefixMap } from "./FlatPrefixMap.js";
import { TypeaheadRedisClient } from "./redis_client.js";

export class AutocompleteService {
  /**
   * @param {object} [options]
   * @param {number} [options.k=5] - Default top-K suggestions count.
   * @param {number} [options.maxPrefixLength=6] - Max prefix length for flat map.
   * @param {TypeaheadRedisClient} [options.redisClient=null] - Redis client instance.
   */
  constructor(options = {}) {
    this.k = options.k || 5;
    this.maxPrefixLength = options.maxPrefixLength || 6;
    this.trie = new TrieService(this.k);
    this.flatPrefixMap = new FlatPrefixMap(this.maxPrefixLength, this.k);
    this.redisClient = options.redisClient || new TypeaheadRedisClient();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Builds both in-memory engines from the query corpus.
   * @param {Array<{ query: string, frequency: number }>|Record<string, number>} queries
   */
  initialize(queries) {
    // TODO 1: Ingest queries into both TrieService and FlatPrefixMap.
    const entries = Array.isArray(queries)
      ? queries
      : Object.entries(queries).map(([query, freq]) => ({ query, frequency: freq }));

    // 1. Build FlatPrefixMap (bounded MinHeap indexing prefixes up to length 6)
    this.flatPrefixMap.build(entries);

    // 2. Build TrieService (V8 hidden class stabilized nodes with bottom-up top-K precomputation)
    this.trie.buildFromDataset(entries, this.k);
  }

  /**
   * Queries the selected in-memory engine directly in RAM.
   * @param {string} prefix - The typed prefix string.
   * @param {"hash"|"trie"} [engine="hash"] - Engine selection.
   * @param {number} [k=5] - Number of suggestions.
   * @returns {{ suggestions: Array<{ query: string, frequency: number }>, tookMs: number }}
   */
  suggest(prefix, engine = "hash", k = 5) {
    // TODO 2: Query the chosen memory engine with high-resolution timing.
    if (!prefix || typeof prefix !== "string") {
      return { suggestions: [], tookMs: 0 };
    }

    const targetK = k || this.k;
    const normalized = prefix.trim().toLowerCase();
    const t0 = process.hrtime.bigint();

    let rawResults = [];
    if (engine === "trie") {
      rawResults = this.trie.suggest(normalized, targetK);
    } else {
      rawResults = this.flatPrefixMap.suggest(normalized, targetK);
    }

    const t1 = process.hrtime.bigint();
    const tookMs = Number(t1 - t0) / 1_000_000;

    // Standardize object property format: { query, frequency }
    const suggestions = rawResults.map((item) => ({
      query: item.query || item.word,
      frequency: item.frequency
    }));

    return { suggestions, tookMs };
  }

  /**
   * Queries L1 Redis hot-prefix cache first; on cache miss, falls back to RAM engine
   * and asynchronously warms the cache with a 5-minute (300s) TTL.
   * @param {string} prefix - The typed prefix string.
   * @param {"hash"|"trie"} [engine="hash"] - Engine selection.
   * @param {number} [k=5] - Number of suggestions.
   * @returns {Promise<{ suggestions: Array<{ query: string, frequency: number }>, source: string, tookMs: number }>}
   */
  async suggestWithCache(prefix, engine = "hash", k = 5) {
    // TODO 3: Implement resilient cache-aside lookup against Redis.
    if (!prefix || typeof prefix !== "string") {
      return { suggestions: [], source: "empty", tookMs: 0 };
    }

    const normalized = prefix.trim().toLowerCase();
    const targetK = k || this.k;
    const t0 = process.hrtime.bigint();

    // 1. Attempt L1 Redis cache lookup
    let cached = null;
    try {
      cached = await this.redisClient.getCachedPrefixResults(normalized);
    } catch {
      // Defensive: Redis error must never crash the read path
      cached = null;
    }

    if (cached !== null && Array.isArray(cached)) {
      this.cacheHits++;
      const t1 = process.hrtime.bigint();
      const tookMs = Number(t1 - t0) / 1_000_000;
      return {
        suggestions: cached.slice(0, targetK),
        source: "redis_cache",
        tookMs
      };
    }

    // 2. Cache miss: Query in-memory engine
    this.cacheMisses++;
    const { suggestions, tookMs: engineTookMs } = this.suggest(normalized, engine, targetK);

    // 3. Asynchronously warm L1 Redis cache with 300s TTL (fire-and-forget)
    if (suggestions.length > 0) {
      this.redisClient.cachePrefixResults(normalized, suggestions, 300).catch(() => {});
    }

    const t1 = process.hrtime.bigint();
    const totalTookMs = Number(t1 - t0) / 1_000_000;

    return {
      suggestions,
      source: `memory_${engine}`,
      tookMs: totalTookMs
    };
  }

  /**
   * Returns memory statistics and key counts for both engines.
   */
  getStats() {
    const uniquePrefixes = this.flatPrefixMap.getPrefixKeyCount();
    return {
      trie: {
        totalWords: this.trie.totalWords,
        totalNodes: this.trie.totalNodes
      },
      flatPrefixMap: {
        uniquePrefixes,
        totalIndexedQueries: this.flatPrefixMap.totalIndexedQueries
      },
      // Flat aliases for backwards compatibility
      trieWords: this.trie.totalWords,
      flatMapPrefixes: uniquePrefixes,
      cache: {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        ratio: this.cacheHits + this.cacheMisses > 0
          ? Number((this.cacheHits / (this.cacheHits + this.cacheMisses)).toFixed(3))
          : 0
      }
    };
  }
}
