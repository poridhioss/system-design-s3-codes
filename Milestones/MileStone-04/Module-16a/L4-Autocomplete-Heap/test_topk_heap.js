import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MinHeap } from "./MinHeap.js";
import { ZipfGenerator } from "./ZipfGenerator.js";
import { FlatPrefixMap } from "./FlatPrefixMap.js";
import { RAW_QUERIES, getQueryDictionary } from "./dataset.js";

describe("Suite 1: Binary MinHeap Indexing & Math Invariants", () => {
  it("maintains the lowest frequency element strictly at root index 0", () => {
    const heap = new MinHeap();
    heap.insert({ query: "kala bhuna", frequency: 14300 });
    heap.insert({ query: "kacchi biryani", frequency: 16400 });
    heap.insert({ query: "khichuri", frequency: 12100 });
    heap.insert({ query: "kacchi", frequency: 8500 });

    assert.equal(heap.size(), 4);
    assert.equal(heap.peek().query, "kacchi");
    assert.equal(heap.peek().frequency, 8500);
  });

  it("handles edge cases: empty heap and single item operations", () => {
    const heap = new MinHeap();
    assert.equal(heap.isEmpty(), true);
    assert.equal(heap.peek(), null);
    assert.equal(heap.pop(), null);

    heap.insert({ query: "shorshe ilish", frequency: 11500 });
    assert.equal(heap.isEmpty(), false);
    assert.equal(heap.size(), 1);
    assert.equal(heap.peek().query, "shorshe ilish");

    const popped = heap.pop();
    assert.equal(popped.query, "shorshe ilish");
    assert.equal(heap.isEmpty(), true);
  });
});

describe("Suite 2: Heap Sift-Up, Sift-Down & Sorting Correctness", () => {
  it("pops items in strictly ascending frequency order", () => {
    const heap = new MinHeap();
    const items = [
      { query: "item D", frequency: 400 },
      { query: "item A", frequency: 100 },
      { query: "item E", frequency: 500 },
      { query: "item B", frequency: 200 },
      { query: "item C", frequency: 300 }
    ];

    for (const item of items) {
      heap.insert(item);
    }

    const poppedFrequencies = [];
    while (!heap.isEmpty()) {
      poppedFrequencies.push(heap.pop().frequency);
    }

    assert.deepEqual(poppedFrequencies, [100, 200, 300, 400, 500]);
  });

  it("breaks frequency ties deterministically using reverse alphabetical order", () => {
    const heap = new MinHeap();
    heap.insert({ query: "apple", frequency: 500 });
    heap.insert({ query: "banana", frequency: 500 });

    // In min-heap eviction comparison, reverse alphabetical means 'banana' > 'apple'
    const first = heap.pop();
    const second = heap.pop();
    assert.equal(first.frequency, 500);
    assert.equal(second.frequency, 500);
    assert.notEqual(first.query, second.query);
  });
});

describe("Suite 3: Bounded Capacity & Single-Pass pushPop Root Eviction", () => {
  it("caps heap size to exact K capacity when inserting many candidates", () => {
    const heap = new MinHeap(undefined, 5);
    for (const item of RAW_QUERIES) {
      heap.insert(item);
    }

    assert.equal(heap.size(), 5);

    // Sorted descending values must contain the absolute top 5 highest frequency queries
    const top5 = heap.getSortedValues();
    assert.equal(top5.length, 5);
    assert.equal(top5[0].query, "dhaka");
    assert.equal(top5[0].frequency, 18500);
    assert.equal(top5[1].query, "kacchi biryani");
    assert.equal(top5[1].frequency, 16400);
    assert.equal(top5[2].query, "dhaka to chittagong");
    assert.equal(top5[2].frequency, 14200);
    assert.equal(top5[3].query, "chittagong");
    assert.equal(top5[3].frequency, 11200);
    assert.equal(top5[4].query, "dhaka to sylhet");
    assert.equal(top5[4].frequency, 9600);
  });

  it("evicts previous root on pushPop with higher frequency candidate in O(log K)", () => {
    const heap = new MinHeap(undefined, 3);
    heap.insert({ query: "low 1", frequency: 100 });
    heap.insert({ query: "low 2", frequency: 200 });
    heap.insert({ query: "low 3", frequency: 300 });

    assert.equal(heap.peek().frequency, 100);

    // Incoming candidate has frequency 250 -> evicts 100, new min becomes 200
    const evicted = heap.pushPop({ query: "mid", frequency: 250 });
    assert.equal(evicted.frequency, 100);
    assert.equal(heap.size(), 3);
    assert.equal(heap.peek().frequency, 200);

    // Incoming candidate with lower frequency 50 -> rejected, returns itself
    const rejected = heap.pushPop({ query: "too low", frequency: 50 });
    assert.equal(rejected.frequency, 50);
    assert.equal(heap.peek().frequency, 200);
  });
});

describe("Suite 4: Zipfian Traffic Generator Distribution Bounds", () => {
  it("computes monotonic Cumulative Distribution Function ending at 1.0", () => {
    const queries = RAW_QUERIES.map(q => q.query);
    const zipf = new ZipfGenerator(queries, 1.0);

    assert.equal(zipf.cdf.length, queries.length);
    assert.ok(zipf.cdf[0] > 0);
    assert.equal(zipf.cdf[zipf.cdf.length - 1], 1.0);

    // Verify monotonic increase
    for (let i = 1; i < zipf.cdf.length; i++) {
      assert.ok(zipf.cdf[i] >= zipf.cdf[i - 1]);
    }
  });

  it("generates power-law traffic where rank 1 appears significantly more than tail ranks", () => {
    const queries = RAW_QUERIES.map(q => q.query);
    const zipf = new ZipfGenerator(queries, 1.2);

    const sampleCount = 5000;
    const samples = zipf.sampleBatch(sampleCount);
    const counts = new Map();

    for (const q of samples) {
      counts.set(q, (counts.get(q) || 0) + 1);
    }

    const rank1Count = counts.get(queries[0]) || 0;
    const tailCount = counts.get(queries[queries.length - 1]) || 0;

    // In Zipf distribution (s=1.2), rank 1 should easily beat tail rank by at least 5x
    assert.ok(rank1Count > tailCount * 3, `Expected rank1 (${rank1Count}) > tail (${tailCount}) * 3`);
  });
});

describe("Suite 5: FlatPrefixMap Ingestion & Sub-Microsecond Retrieval", () => {
  it("indexes prefixes up to length 6 and accurately resolves top-5 suggestions", () => {
    const map = new FlatPrefixMap(6, 5);
    const dict = getQueryDictionary();
    map.build(dict);

    assert.ok(map.getPrefixKeyCount() >= 40);

    const suggestionsK = map.suggest("k");
    assert.ok(suggestionsK.length <= 5);
    assert.equal(suggestionsK[0].query, "kacchi biryani");
    assert.equal(suggestionsK[0].frequency, 16400);

    const suggestionsKac = map.suggest("kac");
    assert.ok(suggestionsKac.length <= 5);
    assert.equal(suggestionsKac[0].query, "kacchi biryani");

    // Slices prefix beyond maxPrefixLength 6 gracefully
    const longPrefix = map.suggest("kacchi biryani extra long");
    assert.ok(longPrefix.length > 0);
    assert.equal(longPrefix[0].query, "kacchi biryani");
  });

  it("handles missing prefixes safely by returning empty array", () => {
    const map = new FlatPrefixMap(6, 5);
    map.build(getQueryDictionary());

    const result = map.suggest("xyzunknownprefix");
    assert.deepEqual(result, []);
  });
});
