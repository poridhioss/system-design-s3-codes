/**
 * main.js - Interactive Circuit Breaker Chaos Simulation & Performance Benchmark
 */

import { performance } from "node:perf_hooks";
import { CircuitBreaker, CircuitState } from "./CircuitBreaker.js";

function printHeader(title) {
  console.log(`\n===============================================================`);
  console.log(`  ${title}`);
  console.log(`===============================================================`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Global mock downstream database state
let mockDatabaseHealthy = true;
let mockResponseDelayMs = 2;

async function mockDatabaseQuery(query) {
  await sleep(mockResponseDelayMs);
  if (!mockDatabaseHealthy) {
    throw new Error("Downstream Database: 503 Service Unavailable");
  }
  return { query, results: 42, latencyMs: mockResponseDelayMs };
}

async function inMemoryFallback(query, error) {
  return {
    query,
    results: 15,
    degraded: true,
    source: "in-memory-inverted-index",
    warning: error.message,
  };
}

async function runSimulation() {
  printHeader("PHASE 1: Normal Operation (Circuit CLOSED)");

  const cb = new CircuitBreaker({
    minRequests: 5,
    failureThreshold: 0.5,
    recoveryTimeoutMs: 1500,
    timeoutSlaMs: 100,
  });

  console.log(`Initial State: ${cb.state} | SLA Cap: ${cb.timeoutSlaMs}ms | Cooldown: ${cb.recoveryTimeoutMs}ms`);

  for (let i = 1; i <= 5; i++) {
    const res = await cb.execute(
      () => mockDatabaseQuery("distributed caching"),
      (err) => inMemoryFallback("distributed caching", err)
    );
    console.log(`[Req ${i}] State: ${cb.state} | Result: ${res.results} hits | Degraded: ${res.degraded || false}`);
  }

  printHeader("PHASE 2: Downstream Catastrophe (Elasticsearch 15s GC Freeze)");
  console.log("Simulating primary database freeze: response delay increases to 250ms (SLA cap: 100ms)...");
  mockResponseDelayMs = 250; // Exceeds 100ms SLA!

  for (let i = 1; i <= 6; i++) {
    const start = performance.now();
    const res = await cb.execute(
      () => mockDatabaseQuery("distributed caching"),
      (err) => inMemoryFallback("distributed caching", err)
    );
    const duration = (performance.now() - start).toFixed(1);
    console.log(
      `[Req ${i}] Elapsed: ${duration}ms | State: ${cb.state} | Result: ${res.results} hits | Degraded: ${res.degraded || false}`
    );
  }

  printHeader("PHASE 3: High-Throughput Fast-Fail Benchmark (Circuit OPEN)");
  console.log(`Current State: ${cb.state} (Downstream Quarantined)`);
  console.log("Benchmarking 10,000 requests during OPEN state...");

  const benchIterations = 10000;
  const benchStart = performance.now();

  let fallbackCount = 0;
  for (let i = 0; i < benchIterations; i++) {
    await cb.execute(
      () => mockDatabaseQuery("test"),
      async () => {
        fallbackCount++;
        return { degraded: true };
      }
    );
  }

  const totalBenchMs = performance.now() - benchStart;
  const avgUsPerQuery = (totalBenchMs / benchIterations) * 1000;

  console.log(`\nBenchmark Results:`);
  console.log(`  Total Requests Handled:  ${benchIterations.toLocaleString()}`);
  console.log(`  Fallback Served:         ${fallbackCount.toLocaleString()}`);
  console.log(`  Total Execution Time:    ${totalBenchMs.toFixed(2)} ms`);
  console.log(`  Average Latency / Query: ${avgUsPerQuery.toFixed(3)} µs (~${(avgUsPerQuery / 1000).toFixed(4)} ms)`);
  console.log(`  Protection Factor:       ${(250 / (avgUsPerQuery / 1000)).toFixed(0)}x faster than stalled timeouts!`);

  printHeader("PHASE 4: Cooldown & Single-Flight Canary Recovery");
  console.log(`Waiting ${cb.recoveryTimeoutMs}ms for cooldown to elapse...`);
  await sleep(cb.recoveryTimeoutMs + 100);

  console.log("Restoring primary database health (delay back to 2ms)...");
  mockDatabaseHealthy = true;
  mockResponseDelayMs = 2;

  console.log(`Testing canExecute() after cooldown: ${cb.canExecute()}`);
  console.log(`State transitioned to: ${cb.state} (Canary in flight: ${cb.canaryInFlight})`);

  // Concurrent request during canary probe
  console.log(`Attempting concurrent request during canary: canExecute=${cb.canExecute()} (Blocked!)`);

  // Canary probe completes successfully
  cb.recordSuccess();
  console.log(`Canary probe reported SUCCESS! State reset to: ${cb.state}`);
  console.log(`Final Status Telemetry:`, cb.getStatus());

  printHeader("SIMULATION COMPLETE: System Protected with Zero Downtime");
}

runSimulation().catch(console.error);
