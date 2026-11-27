import { randomUUID } from 'node:crypto';
import { BitTwiddler } from './BitTwiddler.js';
import { LayoutRegistry } from './LayoutRegistry.js';

const COUNT = 250000;

function formatBytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function runGCIfAvailable() {
  if (global.gc) {
    global.gc();
  }
}

console.log('='.repeat(75));
console.log('Memory Allocation & Generation Benchmark (' + COUNT.toLocaleString() + ' IDs)');
console.log('='.repeat(75));

// Test 1: BigUint64Array (Zero heap object allocation per ID)
runGCIfAvailable();
const heapBefore1 = process.memoryUsage().heapUsed;
const start1 = process.hrtime.bigint();

const buffer = new BigUint64Array(COUNT);
const layout = LayoutRegistry.TWITTER;
const baseTime = 1700000000000n;
for (let i = 0; i < COUNT; i++) {
  const iBig = BigInt(i);
  buffer[i] = BitTwiddler.pack(
    { timestamp: baseTime + (iBig / 4096n), workerId: 12n, sequence: iBig % 4096n },
    layout
  );
}

const end1 = process.hrtime.bigint();
const heapAfter1 = process.memoryUsage().heapUsed;
const duration1Ms = Number(end1 - start1) / 1_000_000;
const heapDelta1 = heapAfter1 - heapBefore1;

console.log('\n1. BigUint64Array (Typed Buffer):');
console.log('   - Time Elapsed:   ' + duration1Ms.toFixed(2) + ' ms (' + ((COUNT / duration1Ms) * 1000).toFixed(0) + ' IDs/sec)');
console.log('   - Heap Allocated: ' + formatBytes(heapDelta1) + ' (buffer size: ' + (buffer.byteLength / 1024 / 1024).toFixed(2) + ' MB)');

// Test 2: Standard BigInt Objects in JavaScript Array
runGCIfAvailable();
const heapBefore2 = process.memoryUsage().heapUsed;
const start2 = process.hrtime.bigint();

const bigIntArray = new Array(COUNT);
for (let i = 0; i < COUNT; i++) {
  const iBig = BigInt(i);
  bigIntArray[i] = BitTwiddler.pack(
    { timestamp: baseTime + (iBig / 4096n), workerId: 12n, sequence: iBig % 4096n },
    layout
  );
}

const end2 = process.hrtime.bigint();
const heapAfter2 = process.memoryUsage().heapUsed;
const duration2Ms = Number(end2 - start2) / 1_000_000;
const heapDelta2 = heapAfter2 - heapBefore2;

console.log('\n2. Native BigInt in JS Array:');
console.log('   - Time Elapsed:   ' + duration2Ms.toFixed(2) + ' ms (' + ((COUNT / duration2Ms) * 1000).toFixed(0) + ' IDs/sec)');
console.log('   - Heap Allocated: ' + formatBytes(heapDelta2));

// Test 3: Hyphenated UUIDv4 Strings (36 characters)
runGCIfAvailable();
const heapBefore3 = process.memoryUsage().heapUsed;
const start3 = process.hrtime.bigint();

const uuidArray = new Array(COUNT);
for (let i = 0; i < COUNT; i++) {
  uuidArray[i] = randomUUID();
}

const end3 = process.hrtime.bigint();
const heapAfter3 = process.memoryUsage().heapUsed;
const duration3Ms = Number(end3 - start3) / 1_000_000;
const heapDelta3 = heapAfter3 - heapBefore3;

console.log('\n3. String UUIDv4 (36-character strings):');
console.log('   - Time Elapsed:   ' + duration3Ms.toFixed(2) + ' ms (' + ((COUNT / duration3Ms) * 1000).toFixed(0) + ' IDs/sec)');
console.log('   - Heap Allocated: ' + formatBytes(heapDelta3));

console.log('\n' + '='.repeat(75));
console.log('Conclusion:');
console.log('- BigUint64Array uses ' + (heapDelta3 / Math.max(1, heapDelta1)).toFixed(1) + 'x LESS heap memory than UUID strings.');
console.log('- Snowflake integers avoid V8 young-generation string garbage collection.');
console.log('='.repeat(75));
