/**
 * redis_client.js - Production Redis Client with Modern ACL Authentication
 *
 * Provides query frequency logging via atomic Redis Sorted Sets (ZINCRBY)
 * and prefix result caching (SETEX/GET) using ioredis.
 */

import Redis from "ioredis";

// ==============================================================================
// REDIS CREDENTIALS CONFIGURATION
// In this lab, navigate to the left-hand navigation sidebar, click on Database,
// provision your Redis instance, and update your credentials below if needed.
// ==============================================================================
export const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
export const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
export const REDIS_USERNAME = process.env.REDIS_USERNAME || "default";
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD || "";
// ==============================================================================

export class TypeaheadRedisClient {
  constructor(options = {}) {
    this.host = options.host || REDIS_HOST;
    this.port = options.port || REDIS_PORT;
    this.username = options.username || REDIS_USERNAME;
    this.password = options.password || REDIS_PASSWORD;

    this.client = new Redis({
      host: this.host,
      port: this.port,
      username: this.username,
      password: this.password,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 100, 1000);
      },
      lazyConnect: true
    });

    this.client.on("error", (err) => {
      if (err.message.includes("WRONGPASS") || err.message.includes("NOAUTH")) {
        console.error("[ERROR] Redis Authentication Failed: Verify REDIS_USERNAME and REDIS_PASSWORD in redis_client.js.");
      }
    });
  }

  async connect() {
    try {
      if (this.client.status === "wait" || this.client.status === "close") {
        await this.client.connect();
      }
    } catch (err) {
      if (err.message.includes("WRONGPASS") || err.message.includes("NOAUTH")) {
        throw new Error(`Redis Authentication Failed: Check REDIS_USERNAME (${this.username}) and REDIS_PASSWORD.`);
      }
      throw err;
    }
  }

  async ping() {
    await this.connect();
    const res = await this.client.ping();
    return res === "PONG";
  }

  async recordQuerySearch(query, increment = 1) {
    if (!query || typeof query !== "string") return null;
    await this.connect();
    const normalized = query.trim().toLowerCase();
    const newScore = await this.client.zincrby("query_frequencies", increment, normalized);
    return Number(newScore);
  }

  async getTopQueries(k = 10) {
    await this.connect();
    const raw = await this.client.zrevrange("query_frequencies", 0, k - 1, "WITHSCORES");
    const results = [];
    for (let i = 0; i < raw.length; i += 2) {
      results.push({
        query: raw[i],
        score: Number(raw[i + 1])
      });
    }
    return results;
  }

  async cachePrefixResults(prefix, results, ttlSeconds = 300) {
    if (!prefix || !results) return false;
    await this.connect();
    const key = `prefix_cache:${prefix.trim().toLowerCase()}`;
    const payload = JSON.stringify(results);
    await this.client.setex(key, ttlSeconds, payload);
    return true;
  }

  async getCachedPrefixResults(prefix) {
    if (!prefix) return null;
    await this.connect();
    const key = `prefix_cache:${prefix.trim().toLowerCase()}`;
    const cached = await this.client.get(key);
    if (!cached) return null;
    try {
      return JSON.parse(cached);
    } catch {
      return null;
    }
  }

  async flushTestData() {
    await this.connect();
    await this.client.del("query_frequencies");
    const stream = this.client.scanStream({ match: "prefix_cache:*", count: 100 });
    for await (const keys of stream) {
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    }
  }

  async disconnect() {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
