/**
 * TrieNode.js - V8 Hidden Class Stabilized Trie Node
 *
 * Enforces predictable C++ struct layouts in V8 by initializing all properties
 * in the constructor and mapping dynamic character edges through a JavaScript Map.
 */

export class TrieNode {
  constructor() {
    // 1. Edge transitions to descendant characters (using Map to prevent shape mutation)
    this.children = new Map();

    // 2. Terminal marker indicating if a complete search query terminates here
    this.isEnd = false;

    // 3. Historical query frequency count (greater than 0 if isEnd is true)
    this.frequency = 0;

    // 4. Stored full query string for this terminal node (null for intermediate nodes)
    this.word = null;

    // 5. Precomputed top-K { word, frequency } suggestions cached at this node
    this.topSuggestions = [];
  }

  getChild(char) {
    return this.children.get(char);
  }

  setChild(char, node) {
    this.children.set(char, node);
    return node;
  }

  hasChild(char) {
    return this.children.has(char);
  }

  get childCount() {
    return this.children.size;
  }
}
