/**
 * server.js - Production Express Autocomplete Microservice
 *
 * Exposes high-throughput RESTful endpoints for prefix suggestions with L1 Redis caching,
 * asynchronous query search logging (ZINCRBY), and memory introspection.
 */

import express from "express";
import { QUERY_DATASET } from "./dataset.js";
import { AutocompleteService } from "./AutocompleteService.js";
import { TypeaheadRedisClient } from "./redis_client.js";

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(express.json());

// Initialize Redis client and Autocomplete Service
const redisClient = new TypeaheadRedisClient();
const autocompleteService = new AutocompleteService({ k: 5, redisClient });

// Seed in-memory engines with familiar query corpus
autocompleteService.initialize(QUERY_DATASET);

/**
 * Health Check Endpoint
 */
app.get("/", (req, res) => {
  res.json({
    status: "healthy",
    service: "High-Throughput Autocomplete Microservice",
    runtime: "Node.js 20+ LTS",
    port: PORT
  });
});

/**
 * Prefix Suggestion Endpoint (Dual-Engine with Redis L1 Cache-Aside)
 * GET /suggest?q=kac&engine=hash&k=5
 */
app.get("/suggest", async (req, res) => {
  const prefix = req.query.q;
  if (!prefix || typeof prefix !== "string" || prefix.trim() === "") {
    return res.status(400).json({ error: "Missing or empty prefix query parameter 'q'." });
  }

  const engine = req.query.engine === "trie" ? "trie" : "hash";
  const k = Math.min(Math.max(Number(req.query.k) || 5, 1), 10);

  try {
    const result = await autocompleteService.suggestWithCache(prefix, engine, k);
    return res.json({
      prefix: prefix.trim().toLowerCase(),
      engine,
      source: result.source,
      count: result.suggestions.length,
      tookMs: Number(result.tookMs.toFixed(3)),
      suggestions: result.suggestions
    });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

/**
 * Asynchronous Query Search Submission Endpoint
 * POST /search { "query": "kacchi biryani", "increment": 1 }
 */
app.post("/search", async (req, res) => {
  const { query, increment = 1 } = req.body || {};
  if (!query || typeof query !== "string" || query.trim() === "") {
    return res.status(400).json({ error: "Invalid search submission: 'query' string is required." });
  }

  const normalized = query.trim().toLowerCase();
  const inc = Number(increment) || 1;

  // Asynchronous fire-and-forget logging to Redis Sorted Set
  redisClient.recordQuerySearch(normalized, inc).catch((err) => {
    console.error("[WARN] Asynchronous query logging to Redis failed:", err.message);
  });

  return res.json({
    status: "recorded",
    query: normalized,
    increment: inc
  });
});

/**
 * Engine Introspection & Memory Metrics Endpoint
 * GET /metrics
 */
app.get("/metrics", async (req, res) => {
  const mem = process.memoryUsage();
  const engineStats = autocompleteService.getStats();
  let topRedisQueries = [];
  try {
    topRedisQueries = await redisClient.getTopQueries(5);
  } catch {
    topRedisQueries = [];
  }

  return res.json({
    memory: {
      heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
      heapTotalMb: Number((mem.heapTotal / (1024 * 1024)).toFixed(2)),
      rssMb: Number((mem.rss / (1024 * 1024)).toFixed(2))
    },
    cache: engineStats.cache,
    engines: engineStats,
    redisTopSearches: topRedisQueries,
    topRedisSearches: topRedisQueries
  });
});

/**
 * Dedicated Readiness & Health Endpoint
 * GET /health
 */
app.get("/health", async (req, res) => {
  let redisConnected = false;
  try {
    redisConnected = await redisClient.ping();
  } catch {
    redisConnected = false;
  }

  return res.json({
    status: "healthy",
    uptimeSeconds: Math.round(process.uptime()),
    redisConnected
  });
});

export { app, autocompleteService, redisClient };

// Start listening if executed directly
if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  app.listen(PORT, () => {
    console.log(`[+] High-Throughput Autocomplete Service running on http://127.0.0.1:${PORT}`);
    console.log(`    - Test suggestions: curl "http://127.0.0.1:${PORT}/suggest?q=kac&engine=hash"`);
    console.log(`    - Metrics summary : curl "http://127.0.0.1:${PORT}/metrics"`);
  });
}
