/**
 * test_text_analyzer.js - Automated Verification Suite
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TextAnalyzer, DEFAULT_STOPWORDS } from "./TextAnalyzer.js";
import { CORPUS } from "./dataset.js";

describe("Stage 1 & 2: Normalization and Unicode Punctuation Stripping", () => {
  const analyzer = new TextAnalyzer();

  test("lowercases raw input and strips ASCII punctuation", () => {
    const raw = "Raft: A Distributed Consensus Algorithm (v2.0)!";
    const expected = "raft  a distributed consensus algorithm  v2 0";
    assert.equal(analyzer.normalize(raw), expected);
  });

  test("preserves international Unicode letters and numbers", () => {
    const raw = "Elasticsearch: Hochverfügbare Suche für München 2026!";
    const expected = "elasticsearch  hochverfügbare suche für münchen 2026";
    assert.equal(analyzer.normalize(raw), expected);
  });

  test("safely handles null, undefined, and non-string inputs", () => {
    assert.equal(analyzer.normalize(null), "");
    assert.equal(analyzer.normalize(undefined), "");
    assert.equal(analyzer.normalize(42), "");
  });
});

describe("Stage 3 & 4: Whitespace Splitting and Stop-word Filtering", () => {
  const analyzer = new TextAnalyzer();

  test("filters out common English stop words", () => {
    const tokens = ["redis", "is", "a", "distributed", "cache", "for", "web", "apps"];
    const filtered = analyzer.filterStopWords(tokens);
    assert.deepEqual(filtered, ["redis", "distributed", "cache", "web", "apps"]);
  });

  test("respects custom stop-word Sets", () => {
    const customAnalyzer = new TextAnalyzer({ stopwords: new Set(["database", "cache"]) });
    const tokens = ["redis", "cache", "database", "cluster"];
    const filtered = customAnalyzer.filterStopWords(tokens);
    assert.deepEqual(filtered, ["redis", "cluster"]);
  });

  test("filters tokens shorter than minTokenLength", () => {
    const customAnalyzer = new TextAnalyzer({ minTokenLength: 3 });
    const tokens = ["a", "to", "in", "raft", "log"];
    const filtered = customAnalyzer.filterStopWords(tokens);
    assert.deepEqual(filtered, ["raft", "log"]);
  });
});

describe("Stage 5: Algorithmic Suffix Stripping", () => {
  const analyzer = new TextAnalyzer();

  test("strips plural suffixes correctly", () => {
    assert.equal(analyzer.stem("leaders"), "leader");
    assert.equal(analyzer.stem("boxes"), "box");
    assert.equal(analyzer.stem("queries"), "query");
  });

  test("preserves root words ending in double-s and Latin roots (-us, -is)", () => {
    assert.equal(analyzer.stem("consensus"), "consensus");
    assert.equal(analyzer.stem("process"), "process");
  });

  test("strips progressive and past tense suffixes", () => {
    assert.equal(analyzer.stem("electing"), "elect");
    assert.equal(analyzer.stem("partitioned"), "partition");
  });

  test("leaves short roots intact", () => {
    assert.equal(analyzer.stem("bus"), "bus");
    assert.equal(analyzer.stem("gas"), "gas");
  });
});

describe("Stage 6: Term Frequencies and Lexicon Construction", () => {
  test("tallies term frequencies with Map", () => {
    const analyzer = new TextAnalyzer();
    const tokens = ["raft", "consensus", "leader", "raft", "leader", "leader"];
    const tf = analyzer.termFrequencies(tokens);

    assert.equal(tf.get("raft"), 2);
    assert.equal(tf.get("consensus"), 1);
    assert.equal(tf.get("leader"), 3);
  });

  test("builds complete Lexicon across multi-document corpus", () => {
    const analyzer = new TextAnalyzer();
    const lexicon = analyzer.buildLexicon(CORPUS);

    assert.ok(lexicon.size > 150);
    assert.ok(lexicon.has("distribut"));
    assert.ok(lexicon.has("consensus"));

    const distEntry = lexicon.get("distribut");
    assert.ok(distEntry.termId >= 1);
    assert.ok(distEntry.docFreq >= 4);
  });
});
