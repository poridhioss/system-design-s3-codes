/**
 * main.js
 *
 * Interactive CLI Demonstration for Module 16a Prereq Lab 02:
 * 1. Two-Pointer Linear Merge Step-by-Step Visualization.
 * 2. Multi-Word Boolean AND Retrieval on Distributed Systems Corpus.
 * 3. Delta Gap Compression & Variable-Byte Storage Savings.
 * 4. High-Throughput Microsecond Intersection Benchmark & V8 Memory Footprint.
 */

import { performance } from "node:perf_hooks";
import {
  SortedPostingList,
  TwoPointerIntersector,
  DeltaCompressor,
} from "./PostingList.js";
import { CorpusIndex, CORPUS } from "./CorpusIndex.js";

function printSeparator(char = "=", len = 80) {
  console.log(char.repeat(len));
}

console.log("\n");
printSeparator();
console.log("   M16a-L2: Contiguous Posting Lists & Two-Pointer Merge (Node.js 20+)   ");
printSeparator();

// -----------------------------------------------------------------------------
// Part 1: Visual Trace of Two-Pointer Intersection
// -----------------------------------------------------------------------------
console.log("\n[Part 1]: Step-by-Step Two-Pointer Linear Merge Simulation");
console.log("Simulating Boolean AND intersection for two posting lists:");
const listA = [1, 3, 5, 7, 9, 12];
const listB = [2, 3, 7, 10, 12, 15];
console.log(`  Posting List A: [ ${listA.join(", ")} ] (Length: ${listA.length})`);
console.log(`  Posting List B: [ ${listB.join(", ")} ] (Length: ${listB.length})\n`);

console.log("Execution Trace:");
let p1 = 0;
let p2 = 0;
let step = 1;
const matches = [];

while (p1 < listA.length && p2 < listB.length) {
  const docA = listA[p1];
  const docB = listB[p2];

  if (docA === docB) {
    console.log(
      `  Step ${String(step).padStart(2)}: p1=${p1} (${docA}), p2=${p2} (${docB}) -> MATCH FOUND! Appending ${docA}. Advance both.`
    );
    matches.push(docA);
    p1++;
    p2++;
  } else if (docA < docB) {
    console.log(
      `  Step ${String(step).padStart(2)}: p1=${p1} (${docA}), p2=${p2} (${docB}) -> ${docA} < ${docB}. Advance p1.`
    );
    p1++;
  } else {
    console.log(
      `  Step ${String(step).padStart(2)}: p1=${p1} (${docA}), p2=${p2} (${docB}) -> ${docA} > ${docB}. Advance p2.`
    );
    p2++;
  }
  step++;
}

console.log(`\nIntersection Result: [ ${matches.join(", ")} ] (Total Pointer Steps: ${step - 1})\n`);

// -----------------------------------------------------------------------------
// Part 2: Corpus Ingestion and Multi-Word Boolean Retrieval
// -----------------------------------------------------------------------------
printSeparator("-");
console.log("   [Part 2]: Multi-Word Boolean AND Retrieval on Technical Corpus       ");
printSeparator("-");

const index = new CorpusIndex();
index.buildIndex(CORPUS);
console.log(`Indexed ${CORPUS.length} documents into in-memory posting lists.\n`);

const testQueries = [
  "distributed leader",
  "redis cache",
  "storage throughput",
  "storage cache memory",
  "raft paxos",
];

for (const q of testQueries) {
  const start = performance.now();
  const res = index.searchBooleanAnd(q);
  const elapsed = (performance.now() - start).toFixed(3);

  console.log(`Query: "${q}" (Resolved in ${elapsed} ms, ${res.operations} pointer operations)`);
  if (res.matchedDocIds.length === 0) {
    console.log("  ↳ Matching Document IDs: [] (Empty set: zero documents satisfy all terms)\n");
  } else {
    console.log(`  ↳ Matching Document IDs: [ ${res.matchedDocIds.join(", ")} ]`);
    for (const doc of res.matchedDocuments) {
      console.log(`     • [Doc ${doc.id}]: "${doc.title}"`);
    }
    console.log("");
  }
}

// -----------------------------------------------------------------------------
// Part 3: Delta Gap Compression & Memory Savings
// -----------------------------------------------------------------------------
printSeparator("-");
console.log("   [Part 3]: Delta Gap Compression & Memory Reduction                   ");
printSeparator("-");

// Synthetic monotonic sequence representing a large posting list
const syntheticPostings = [
  1000, 1004, 1007, 1012, 1015, 1022, 1025, 1029, 1035, 1042,
  1045, 1048, 1054, 1060, 1065, 1071, 1078, 1085, 1090, 1095,
];

const deltas = DeltaCompressor.encode(syntheticPostings);
const reconstructed = DeltaCompressor.decode(deltas);
const savings = DeltaCompressor.estimateMemorySavings(deltas);

console.log(`Original DocIDs (first 10):  [ ${syntheticPostings.slice(0, 10).join(", ")} ... ]`);
console.log(`Delta Gaps (first 10):       [ ${deltas.slice(0, 10).join(", ")} ... ]`);
console.log(`Reconstruction Verified:     ${JSON.stringify(syntheticPostings) === JSON.stringify(reconstructed)}`);
console.log(`\nMemory Comparison (${syntheticPostings.length} document IDs):`);
console.log(`  - Raw 32-bit Integer Array:  ${savings.rawBytes} bytes`);
console.log(`  - Variable-Byte Compressed:  ${savings.compressedBytes} bytes`);
console.log(`  - Direct Memory Savings:     ${savings.savingsPercent.toFixed(1)}% reduction\n`);

// -----------------------------------------------------------------------------
// Part 4: High-Throughput Intersection Benchmark & V8 Memory Footprint
// -----------------------------------------------------------------------------
printSeparator("-");
console.log("   [Part 4]: High-Throughput Microsecond Intersection Benchmark         ");
printSeparator("-");

// Generate two large synthetic sorted lists (50,000 document IDs each)
const N = 50000;
const bigListA = new Uint32Array(N);
const bigListB = new Uint32Array(N);

let valA = 0;
let valB = 0;
for (let i = 0; i < N; i++) {
  valA += Math.floor(Math.random() * 4) + 1;
  valB += Math.floor(Math.random() * 4) + 1;
  bigListA[i] = valA;
  bigListB[i] = valB;
}

const benchRuns = 1000;
const benchStart = performance.now();
let totalMatches = 0;

for (let r = 0; r < benchRuns; r++) {
  const { matches } = TwoPointerIntersector.intersect2(bigListA, bigListB);
  totalMatches += matches.length;
}

const benchDurationMs = performance.now() - benchStart;
const opsPerSec = Math.floor((benchRuns / (benchDurationMs / 1000)));
const avgLatencyUs = ((benchDurationMs / benchRuns) * 1000).toFixed(2);

const mem = process.memoryUsage();
console.log(`Benchmark Load:       ${benchRuns.toLocaleString()} intersections of 50,000-doc lists`);
console.log(`Total Execution Time: ${benchDurationMs.toFixed(2)} ms`);
console.log(`Average Latency:      ${avgLatencyUs} µs per 50,000-doc intersection`);
console.log(`Throughput:           ${opsPerSec.toLocaleString()} intersections/second`);
console.log(`V8 Heap Used:         ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
console.log(`V8 Heap Total:        ${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`);
console.log(`RSS Memory:           ${(mem.rss / 1024 / 1024).toFixed(2)} MB\n`);

printSeparator();
console.log("   Next Step: In the applied search engine lab, we combine PostingList.js   ");
console.log("   and TextAnalyzer to build the complete search engine with BM25 ranking!  ");
printSeparator();
console.log("\n");
