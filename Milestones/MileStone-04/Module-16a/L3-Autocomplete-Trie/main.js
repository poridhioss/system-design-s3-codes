/**
 * main.js - Interactive Typeahead Simulation & Performance Benchmark
 */

import { performance } from "node:perf_hooks";
import { TrieService } from "./TrieService.js";
import { QUERY_DATASET } from "./dataset.js";

const trie = new TrieService(5);
trie.buildFromDataset(QUERY_DATASET);

console.log("\n--- Real-Time Keystroke Simulation: 'k' -> 'kacchi' ---");
for (const prefix of ["k", "ka", "kac", "kacc", "kacch", "kacchi"]) {
  const start = performance.now();
  const suggestions = trie.getSuggestions(prefix, 5);
  const latencyUs = (performance.now() - start) * 1000;
  console.log(`Keystroke: "${prefix}" | Latency: ${latencyUs.toFixed(2)} µs | Top: ${suggestions[0]?.word}`);
}

console.log("\n--- Benchmark: Precomputed Top-K Cache vs Naive Subtree DFS ---");
const iterations = 20000;
const testPrefix = "dhaka to";

const cacheStart = performance.now();
for (let i = 0; i < iterations; i++) {
  trie.getSuggestions(testPrefix, 5);
}
const cacheAvgUs = ((performance.now() - cacheStart) / iterations) * 1000;

const targetNode = trie.findPrefixNode(testPrefix);
const dfsStart = performance.now();
for (let i = 0; i < iterations; i++) {
  trie.collectSubtreeWords(targetNode).slice(0, 5);
}
const dfsAvgUs = ((performance.now() - dfsStart) / iterations) * 1000;

console.log(`Precomputed Top-K Cache: ${cacheAvgUs.toFixed(3)} µs / query`);
console.log(`Naive Subtree DFS Walk:  ${dfsAvgUs.toFixed(3)} µs / query`);
