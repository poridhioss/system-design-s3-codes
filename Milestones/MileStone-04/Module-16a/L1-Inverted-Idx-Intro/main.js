/**
 * main.js - Master Text Ingestion Demonstration & Benchmark
 */
import { performance } from "node:perf_hooks";
import { TextAnalyzer } from "./TextAnalyzer.js";
import { CORPUS } from "./dataset.js";

function printSeparator(char = "=", len = 80) {
  console.log(char.repeat(len));
}

console.log("\n");
printSeparator();
console.log("   M16a-L1: Text Processing & Ingestion Pipeline Demonstration (Node.js 20+)   ");
printSeparator();

const analyzer = new TextAnalyzer();
const sampleDoc = CORPUS[0];

console.log(`\n[Document 1 Title]: "${sampleDoc.title}"`);
console.log(`[Raw Document Body (first 120 chars)]:\n  "${sampleDoc.body.slice(0, 120)}..."\n`);

const normalized = analyzer.normalize(sampleDoc.body);
console.log(`[Normalized Text (Lowercase + Unicode Punctuation Stripped)]:\n  "${normalized.slice(0, 120)}..."\n`);

const rawTokens = sampleDoc.body.split(/\s+/);
const tokens = analyzer.analyze(`${sampleDoc.title} ${sampleDoc.body}`);

const rawWordCount = rawTokens.length;
const stopWordsRemovedCount = rawWordCount - tokens.length;

console.log(`[Tokenization Statistics]:`);
console.log(`  - Raw word count:           ${rawWordCount}`);
console.log(`  - Clean searchable tokens:   ${tokens.length}`);
console.log(`  - Stop-words filtered:      ${stopWordsRemovedCount} (${((stopWordsRemovedCount / rawWordCount) * 100).toFixed(1)}% reduction)\n`);

console.log(`[Extracted Token Stream (first 15 tokens)]:`);
console.log(`  [ ${tokens.slice(0, 15).map(t => `"${t}"`).join(", ")} ]\n`);

printSeparator("-");
console.log("   Building Global Lexicon Dictionary Across Full Corpus (8 Documents)          ");
printSeparator("-");

const startTime = performance.now();
const lexicon = analyzer.buildLexicon(CORPUS);
const durationMs = performance.now() - startTime;

console.log(`\nIndexed ${CORPUS.length} documents in ${durationMs.toFixed(3)} ms.`);
console.log(`Total unique vocabulary terms in Lexicon: ${lexicon.size}\n`);

const sortedLexicon = Array.from(lexicon.entries())
  .sort((a, b) => b[1].totalCount - a[1].totalCount)
  .slice(0, 12);

console.log("Top 12 Most Frequent Vocabulary Terms in Lexicon:");
printSeparator("-");
console.log(`| Term ID | Vocabulary Term     | Document Frequency (DF) | Total Count        |`);
printSeparator("-");

for (const [term, meta] of sortedLexicon) {
  const idCol = String(meta.termId).padStart(7, " ");
  const termCol = term.padEnd(19, " ");
  const dfCol = `${meta.docFreq} / ${CORPUS.length} docs`.padEnd(23, " ");
  const countCol = String(meta.totalCount).padStart(18, " ");
  console.log(`| ${idCol} | ${termCol} | ${dfCol} | ${countCol} |`);
}
printSeparator("-");

printSeparator("-");
console.log("   V8 Engine Memory Footprint & Ingestion Throughput Profiling                  ");
printSeparator("-");

const memUsage = process.memoryUsage();
console.log(`\nV8 Heap Used:      ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
console.log(`V8 Heap Total:     ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
console.log(`RSS Memory:        ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB\n`);

const benchmarkRuns = 5000;
const benchmarkText = `${CORPUS[0].title} ${CORPUS[0].body} ${CORPUS[2].body} ${CORPUS[3].body}`;
const benchStart = performance.now();

let totalBenchmarkTokens = 0;
for (let i = 0; i < benchmarkRuns; i++) {
  const stream = analyzer.analyze(benchmarkText);
  totalBenchmarkTokens += stream.length;
}

const benchEnd = performance.now();
const benchDurationSec = (benchEnd - benchStart) / 1000;
const throughput = Math.floor(totalBenchmarkTokens / benchDurationSec);

console.log(`Benchmark Load:    ${benchmarkRuns} document tokenizations`);
console.log(`Total Tokens:      ${totalBenchmarkTokens.toLocaleString()}`);
console.log(`Execution Time:    ${(benchDurationSec * 1000).toFixed(2)} ms`);
console.log(`Token Throughput:  ${throughput.toLocaleString()} tokens/second\n`);

printSeparator();
console.log("   Next Step: In Lab 2, we feed these clean tokens into contiguous Uint32Array  ");
console.log("   posting lists for sub-millisecond Boolean intersection merges!               ");
printSeparator();
console.log("\n");
