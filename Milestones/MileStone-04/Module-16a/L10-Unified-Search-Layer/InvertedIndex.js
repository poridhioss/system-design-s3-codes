/**
 * InvertedIndex.js
 *
 * In-memory inverted index data structure.
 * Maintains the Lexicon (Dictionary) mapping vocabulary terms to SortedPostingList instances.
 * Tracks collection-level statistics (total documents, document lengths, and average document length avgdl)
 * essential for Okapi BM25 length normalization.
 */

import { SortedPostingList } from "./PostingList.js";

export class InvertedIndex {
  constructor() {
    /** @type {Map<string, SortedPostingList>} Dictionary: term -> SortedPostingList */
    this.dictionary = new Map();
    /** @type {Map<number, number>} Document length table: docId -> token count */
    this.docLengths = new Map();
    this.totalDocs = 0;
    this.totalTokens = 0;
  }

  /**
   * Average document length across the entire indexed collection (avgdl).
   * @returns {number}
   */
  get avgDocLen() {
    if (this.totalDocs === 0) return 0;
    return this.totalTokens / this.totalDocs;
  }

  /**
   * Total number of unique vocabulary terms in the dictionary.
   * @returns {number}
   */
  get vocabularySize() {
    return this.dictionary.size;
  }

  /**
   * Indexes a single document.
   * Ingests pre-analyzed tokens, calculates term frequencies, updates collection
   * length statistics, and appends postings.
   *
   * @param {number} docId - Monotonically increasing document identifier.
   * @param {string[]} tokens - Normalized, stemmed token stream from TextAnalyzer.
   */
  addDocument(docId, tokens) {
    if (typeof docId !== "number" || docId < 0 || !Number.isInteger(docId)) {
      throw new TypeError(`Invalid docId: ${docId}. Expected non-negative integer.`);
    }
    if (!Array.isArray(tokens)) {
      throw new TypeError(`Invalid tokens: expected array of strings.`);
    }

    const docLen = tokens.length;
    this.totalDocs += 1;
    this.totalTokens += docLen;
    this.docLengths.set(docId, docLen);

    // Count term frequencies for this document
    const tfMap = new Map();
    for (const token of tokens) {
      tfMap.set(token, (tfMap.get(token) || 0) + 1);
    }

    // Append posting to each term's SortedPostingList
    for (const [term, freq] of tfMap.entries()) {
      let postingList = this.dictionary.get(term);
      if (!postingList) {
        postingList = new SortedPostingList(term);
        this.dictionary.set(term, postingList);
      }
      postingList.add(docId, freq);
    }
  }

  /**
   * Returns the SortedPostingList for a given vocabulary term.
   * @param {string} term
   * @returns {SortedPostingList | null}
   */
  getPostings(term) {
    return this.dictionary.get(term) || null;
  }

  /**
   * Returns Document Frequency (DF) — how many unique documents contain this term.
   * @param {string} term
   * @returns {number}
   */
  getDocFreq(term) {
    const postings = this.dictionary.get(term);
    return postings ? postings.length : 0;
  }

  /**
   * Returns the length (total tokens) of a specific document.
   * @param {number} docId
   * @returns {number}
   */
  getDocLen(docId) {
    return this.docLengths.get(docId) || 0;
  }

  /**
   * Returns term frequency of a term in a specific document.
   * @param {string} term
   * @param {number} docId
   * @returns {number}
   */
  getTermFreq(term, docId) {
    const postings = this.dictionary.get(term);
    if (!postings) return 0;
    const docIds = postings.getDocIds();
    const idx = docIds.indexOf(docId);
    if (idx === -1) return 0;
    return postings.termFreqs[idx];
  }
}
