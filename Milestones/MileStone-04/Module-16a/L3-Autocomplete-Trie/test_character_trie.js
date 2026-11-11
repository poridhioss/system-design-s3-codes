/**
 * test_character_trie.js - Automated Unit Test Suite for Character Trie
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TrieNode } from "./TrieNode.js";
import { TrieService } from "./TrieService.js";
import { QUERY_DATASET } from "./dataset.js";

describe("Suite 1: TrieNode V8 Shape Stabilization & Property Invariants", () => {
  test("initializes node with exact expected properties", () => {
    const node = new TrieNode();
    assert.ok(node.children instanceof Map);
    assert.equal(node.isEnd, false);
    assert.equal(node.frequency, 0);
    assert.equal(node.word, null);
    assert.deepEqual(node.topSuggestions, []);
    assert.equal(node.childCount, 0);
  });

  test("maintains identical property keys order across instances", () => {
    const nodeA = new TrieNode();
    const nodeB = new TrieNode();
    assert.deepEqual(Object.keys(nodeA), Object.keys(nodeB));
  });

  test("manages character edge transitions via accessor methods", () => {
    const parent = new TrieNode();
    const child = new TrieNode();
    parent.setChild("a", child);
    assert.equal(parent.hasChild("a"), true);
    assert.equal(parent.getChild("a"), child);
  });
});

describe("Suite 2: Query Insertion and O(L) Prefix Navigation", () => {
  test("inserts words and correctly tracks node and word counts", () => {
    const trie = new TrieService();
    assert.equal(trie.insert("dhaka", 18500), true);
    assert.equal(trie.totalWords, 1);
    assert.equal(trie.totalNodes, 6);

    assert.equal(trie.insert("dhanmondi", 7300), true);
    assert.equal(trie.totalWords, 2);
    assert.equal(trie.totalNodes, 12);
  });

  test("normalizes query strings (casing and whitespace)", () => {
    const trie = new TrieService();
    trie.insert("  Kacchi Biryani  ", 16400);
    const node = trie.findPrefixNode("kacchi biryani");
    assert.ok(node !== null);
    assert.equal(node.word, "kacchi biryani");
  });

  test("locates prefix nodes in O(L) steps and handles misses", () => {
    const trie = new TrieService();
    trie.insert("chittagong", 11200);
    assert.ok(trie.findPrefixNode("chitt") !== null);
    assert.equal(trie.findPrefixNode("chittagongz"), null);
  });
});

describe("Suite 3: The Self-Ending Word Edge Case Invariant", () => {
  test("preserves parent word when parent is both prefix and terminal word", () => {
    const trie = new TrieService(5);
    trie.insert("kacchi", 8500);
    trie.insert("kacchi biryani", 16400);
    trie.insert("kacchi mutton", 9200);
    trie.precomputeTopK();

    const suggestions = trie.getSuggestions("kacchi");
    assert.equal(suggestions.length, 3);
    assert.equal(suggestions[0].word, "kacchi biryani"); // 16400
    assert.equal(suggestions[1].word, "kacchi mutton");  // 9200
    assert.equal(suggestions[2].word, "kacchi");         // 8500 (Retained!)
  });
});

describe("Suite 4: Bottom-Up Post-Order Top-K Caching & Bounds", () => {
  test("caps topSuggestions array to exact k bound", () => {
    const trie = new TrieService(3);
    trie.insert("bhorta a", 100);
    trie.insert("bhorta b", 200);
    trie.insert("bhorta c", 300);
    trie.insert("bhorta d", 400);
    trie.precomputeTopK();

    const suggestions = trie.getSuggestions("bhorta");
    assert.equal(suggestions.length, 3);
    assert.equal(suggestions[0].word, "bhorta d");
  });
});

describe("Suite 5: End-to-End Dataset Ingestion & Retrieval Speed", () => {
  test("builds full query dataset and accurately resolves multi-word prefixes", () => {
    const trie = new TrieService(5);
    trie.buildFromDataset(QUERY_DATASET);

    const kacchiSuggestions = trie.getSuggestions("kacchi");
    assert.equal(kacchiSuggestions.length, 5);
    assert.equal(kacchiSuggestions[0].word, "kacchi biryani");
  });

  test("retrieves precomputed suggestions in sub-millisecond time", () => {
    const trie = new TrieService(5);
    trie.buildFromDataset(QUERY_DATASET);

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      trie.getSuggestions("kac");
    }
    const avgMs = (performance.now() - start) / 1000;
    assert.ok(avgMs < 0.05, `Average lookup took ${avgMs}ms, expected < 0.05ms`);
  });
});
