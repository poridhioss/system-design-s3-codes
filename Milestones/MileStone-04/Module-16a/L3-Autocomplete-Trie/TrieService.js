/**
 * TrieService.js - High-Throughput Typeahead Prefix Tree Engine
 *
 * Implements O(L) character prefix navigation and compile-time bottom-up
 * Top-K precomputation with self-ending word candidate preservation.
 */

import { TrieNode } from "./TrieNode.js";

export class TrieService {
  constructor(k = 5) {
    this.root = new TrieNode();
    this.k = k;
    this.totalWords = 0;
    this.totalNodes = 1;
  }

  insert(query, frequency = 1) {
    if (typeof query !== "string" || query.trim() === "") {
      return false;
    }

    const normalized = query.trim().toLowerCase();
    let current = this.root;

    for (const char of normalized) {
      if (!current.hasChild(char)) {
        current.setChild(char, new TrieNode());
        this.totalNodes++;
      }
      current = current.getChild(char);
    }

    if (!current.isEnd) {
      this.totalWords++;
    }

    current.isEnd = true;
    current.frequency = frequency;
    current.word = normalized;
    return true;
  }

  findPrefixNode(prefix) {
    if (typeof prefix !== "string") {
      return null;
    }

    const normalized = prefix.trim().toLowerCase();
    if (normalized === "") {
      return this.root;
    }

    let current = this.root;
    for (const char of normalized) {
      if (!current.hasChild(char)) {
        return null;
      }
      current = current.getChild(char);
    }

    return current;
  }

  buildFromDataset(dataset, k = null) {
    if (k !== null) {
      this.k = k;
    }

    for (const item of dataset) {
      this.insert(item.query, item.frequency);
    }

    this.precomputeTopK(this.k);
  }

  precomputeTopK(k = null) {
    const targetK = k !== null ? k : this.k;

    const _postOrderDfs = (node) => {
      const candidates = new Map();

      // 1. Recurse into all child branches first (bottom-up post-order traversal)
      for (const child of node.children.values()) {
        const childSuggestions = _postOrderDfs(child);
        for (const item of childSuggestions) {
          const existing = candidates.get(item.word) || 0;
          if (item.frequency > existing) {
            candidates.set(item.word, item.frequency);
          }
        }
      }

      // 2. The Self-Ending Word Invariant:
      // If a valid search query terminates at this internal node, merge it!
      // Example: prefix "docker" is an internal branch to "docker compose",
      // but "docker" is also a standalone query with its own search volume.
      if (node.isEnd && node.word) {
        const existing = candidates.get(node.word) || 0;
        if (node.frequency > existing) {
          candidates.set(node.word, node.frequency);
        }
      }

      // 3. Sort candidates descending by frequency, break ties alphabetically
      const sorted = Array.from(candidates.entries())
        .map(([word, frequency]) => ({ word, frequency }))
        .sort((a, b) => {
          if (b.frequency !== a.frequency) {
            return b.frequency - a.frequency;
          }
          return a.word.localeCompare(b.word);
        });

      // 4. Cache precomputed top-K results directly on this node
      node.topSuggestions = sorted.slice(0, targetK);
      return node.topSuggestions;
    };

    _postOrderDfs(this.root);
  }

  getSuggestions(prefix, k = null) {
    const targetK = k !== null ? k : this.k;
    const node = this.findPrefixNode(prefix);

    if (!node) {
      return [];
    }

    return node.topSuggestions.slice(0, targetK);
  }

  collectSubtreeWords(node) {
    if (!node) {
      return [];
    }

    const words = [];
    const stack = [node];

    while (stack.length > 0) {
      const curr = stack.pop();
      if (curr.isEnd && curr.word) {
        words.push({ word: curr.word, frequency: curr.frequency });
      }
      for (const child of curr.children.values()) {
        stack.push(child);
      }
    }

    return words.sort((a, b) => {
      if (b.frequency !== a.frequency) {
        return b.frequency - a.frequency;
      }
      return a.word.localeCompare(b.word);
    });
  }

  getStats() {
    return {
      totalWords: this.totalWords,
      totalNodes: this.totalNodes,
    };
  }
}
