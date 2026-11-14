/**
 * test_redis.js - Standalone Redis Connectivity & Operations Verification
 *
 * Verifies Redis ACL authentication, PING health, atomic Sorted Set ZINCRBY,
 * and L1 prefix caching (SETEX/GET) against your Poridhi Redis instance.
 */

import { TypeaheadRedisClient, REDIS_HOST, REDIS_PORT, REDIS_USERNAME } from "./redis_client.js";

async function runRedisVerification() {
  console.log("=".repeat(75));
  console.log("  REDIS ACL CONNECTIVITY & OPERATIONS VERIFICATION");
  console.log("=".repeat(75));
  console.log(`[*] Target Host    : ${REDIS_HOST}:${REDIS_PORT}`);
  console.log(`[*] ACL Username   : ${REDIS_USERNAME}`);

  const redis = new TypeaheadRedisClient();

  try {
    // 1. Test PING
    console.log("\n[1/4] Testing Redis PING...");
    const pingOk = await redis.ping();
    if (!pingOk) {
      throw new Error("Redis did not respond with PONG.");
    }
    console.log("      [PASS] Connection established. Redis responded with PONG.");

    // 2. Test Atomic Frequency Increment (ZINCRBY)
    console.log("\n[2/4] Testing Atomic Query Logging (ZINCRBY)...");
    const testQuery = "kacchi biryani";
    await redis.flushTestData();
    const score1 = await redis.recordQuerySearch(testQuery, 5);
    const score2 = await redis.recordQuerySearch(testQuery, 2);
    console.log(`      Query: '${testQuery}' -> Score after +5: ${score1}, after +2: ${score2}`);
    if (score2 !== 7) {
      throw new Error(`Expected score 7, got ${score2}`);
    }
    console.log("      [PASS] Atomic frequency increment verified.");

    // 3. Test Prefix Result Caching (SETEX / GET)
    console.log("\n[3/4] Testing Hot-Prefix Caching (SETEX & GET)...");
    const testPrefix = "kac";
    const testResults = [
      { query: "kacchi biryani", frequency: 16400 },
      { query: "kacchi mutton", frequency: 9200 }
    ];
    await redis.cachePrefixResults(testPrefix, testResults, 60);
    const cached = await redis.getCachedPrefixResults(testPrefix);
    console.log(`      Cached items for prefix '${testPrefix}':`, cached);
    if (!cached || cached.length !== 2 || cached[0].query !== "kacchi biryani") {
      throw new Error("Cache read did not match written results.");
    }
    console.log("      [PASS] L1 hot-prefix caching and retrieval verified.");

    // 4. Test Top Queries Retrieval
    console.log("\n[4/4] Testing Top Query Ranking Retrieval...");
    await redis.recordQuerySearch("dhaka to chittagong", 15);
    await redis.recordQuerySearch("sylhet tea garden", 3);
    const topQueries = await redis.getTopQueries(3);
    console.log("      Top Queries in Redis:", topQueries);
    if (topQueries[0].query !== "dhaka to chittagong" || topQueries[0].score !== 15) {
      throw new Error("Top query ranking mismatch.");
    }
    console.log("      [PASS] Sorted Set top-K ranking verified.");

    // Cleanup
    await redis.flushTestData();
    console.log("\n[+] All Redis tests passed successfully! Cleaned up test keys.");
  } catch (err) {
    console.error("\n[FAIL] Redis Verification Failed:");
    console.error(`       Error: ${err.message}`);
    console.error("\n[DIAGNOSTIC GUIDANCE]:");
    console.error("1. Ensure your Redis database is provisioned in the Poridhi Database panel.");
    console.error("2. Verify that REDIS_HOST, REDIS_PORT, REDIS_USERNAME, and REDIS_PASSWORD in redis_client.js match your dashboard.");
    console.error("3. If using local Redis, ensure the redis-server service is running.");
    process.exitCode = 1;
  } finally {
    await redis.disconnect();
  }
}

runRedisVerification();
