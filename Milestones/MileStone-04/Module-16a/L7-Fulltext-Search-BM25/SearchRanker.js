/**
 * SearchRanker.js
 *
 * Boolean candidate retrieval and statistical relevance ranking engine.
 * Integrates Two-Pointer intersection (from Lab 2) for candidate generation,
 * classic TF-IDF, and industry-standard Okapi BM25 scoring with term frequency
 * saturation (k1) and document length normalization (b).
 *
 * Exposes a transparent explainScore() method modeled after Elasticsearch's _explain API.
 */

import { TwoPointerIntersector } from "./PostingList.js";

export class SearchRanker {
  /**
   * @param {import('./InvertedIndex.js').InvertedIndex} index
   * @param {import('./TextAnalyzer.js').TextAnalyzer} analyzer
   */
  constructor(index, analyzer) {
    this.index = index;
    this.analyzer = analyzer;
  }

  /**
   * Candidate Generation Stage (Boolean AND Intersection).
   * Finds all documents containing ALL query tokens using TwoPointerIntersector.
   *
   * @param {string[]} queryTokens
   * @returns {number[]} Array of matching Document IDs.
   */
  getCandidates(queryTokens) {
    if (!Array.isArray(queryTokens) || queryTokens.length === 0) {
      return [];
    }

    // Fetch posting lists for each query token
    const postingLists = [];
    for (const term of queryTokens) {
      const postings = this.index.getPostings(term);
      if (!postings || postings.length === 0) {
        // If any term is not in the corpus, Boolean AND yields empty set
        return [];
      }
      postingLists.push(postings);
    }

    // Use shortest-list-first two-pointer multi-intersection
    const { matches } = TwoPointerIntersector.intersectMulti(postingLists);
    return matches;
  }

  /**
   * Calculates Inverse Document Frequency (IDF) using the standard
   * Lucene / Robertson-Sparck Jones BM25 formula:
   * IDF(t) = ln(1 + (N - DF + 0.5) / (DF + 0.5))
   *
   * @param {string} term
   * @returns {number}
   */
  calculateIDF(term) {
    const docCount = this.index.totalDocs;
    const df = this.index.getDocFreq(term);
    if (df === 0 || docCount === 0) {
      return 0.0;
    }

    return Math.log(1.0 + (docCount - df + 0.5) / (df + 0.5));
  }

  /**
   * Calculates classic linear TF-IDF score for a candidate document:
   * Score = sum( TF(t, D) * IDF(t) )
   * Vulnerable to keyword stuffing and verbosity bias.
   *
   * @param {string[]} queryTokens
   * @param {number} docId
   * @returns {number}
   */
  scoreTFIDF(queryTokens, docId) {
    let totalScore = 0.0;
    for (const term of queryTokens) {
      const tf = this.index.getTermFreq(term, docId);
      const idf = this.calculateIDF(term);
      totalScore += tf * idf;
    }
    return totalScore;
  }

  /**
   * Calculates Okapi BM25 score for a candidate document:
   * Score = sum( IDF(t) * (TF * (k1 + 1)) / (TF + k1 * (1 - b + b * (dl / avgdl))) )
   *
   * @param {string[]} queryTokens - Analyzed query terms.
   * @param {number} docId - Target document identifier.
   * @param {number} [k1=1.2] - Term saturation parameter (approaches horizontal asymptote).
   * @param {number} [b=0.75] - Document length normalization factor (0 = off, 1 = strict).
   * @returns {number}
   */
  scoreBM25(queryTokens, docId, k1 = 1.2, b = 0.75) {
    let totalScore = 0.0;
    const docLen = this.index.getDocLen(docId);
    const avgLen = this.index.avgDocLen;

    // Length normalization factor: (1 - b + b * (docLen / avgLen))
    const lenNorm = avgLen > 0 ? 1.0 - b + b * (docLen / avgLen) : 1.0;

    for (const term of queryTokens) {
      const tf = this.index.getTermFreq(term, docId);
      if (tf === 0) continue;

      const idf = this.calculateIDF(term);

      // Saturated, normalized term frequency factor
      const tfNorm = (tf * (k1 + 1.0)) / (tf + k1 * lenNorm);

      totalScore += idf * tfNorm;
    }

    return totalScore;
  }

  /**
   * Decomposes the score for a specific document into a transparent,
   * term-by-term mathematical breakdown (mirroring Elasticsearch's _explain API).
   *
   * @param {string} query
   * @param {number} docId
   * @param {number} [k1=1.2]
   * @param {number} [b=0.75]
   * @returns {object}
   */
  explainScore(query, docId, k1 = 1.2, b = 0.75) {
    const tokens = this.analyzer.analyze(query);
    const docLen = this.index.getDocLen(docId);
    const avgLen = this.index.avgDocLen;
    const lenNorm = avgLen > 0 ? 1.0 - b + b * (docLen / avgLen) : 1.0;

    const breakdown = {
      docId,
      docLen,
      avgLen: Math.round(avgLen * 100) / 100,
      lenRatio: avgLen > 0 ? Math.round((docLen / avgLen) * 100) / 100 : 1.0,
      lengthNormFactor: Math.round(lenNorm * 10000) / 10000,
      k1,
      b,
      terms: [],
      bm25Score: 0.0,
      tfidfScore: 0.0,
    };

    let bm25Total = 0.0;
    let tfidfTotal = 0.0;

    for (const term of tokens) {
      const tf = this.index.getTermFreq(term, docId);
      const idf = this.calculateIDF(term);
      const tfNorm = tf > 0 ? (tf * (k1 + 1.0)) / (tf + k1 * lenNorm) : 0.0;
      const termBM25 = idf * tfNorm;
      const termTFIDF = tf * idf;

      bm25Total += termBM25;
      tfidfTotal += termTFIDF;

      breakdown.terms.push({
        term,
        tf,
        idf: Math.round(idf * 10000) / 10000,
        tfNorm: Math.round(tfNorm * 10000) / 10000,
        bm25Contribution: Math.round(termBM25 * 10000) / 10000,
        tfidfContribution: Math.round(termTFIDF * 10000) / 10000,
      });
    }

    breakdown.bm25Score = Math.round(bm25Total * 10000) / 10000;
    breakdown.tfidfScore = Math.round(tfidfTotal * 10000) / 10000;
    return breakdown;
  }

  /**
   * End-to-end full-text search pipeline:
   * 1. Analyzes query using TextAnalyzer.
   * 2. Retrieves candidates via Boolean AND intersection.
   * 3. Scores each candidate using BM25 or TF-IDF.
   * 4. Returns top-K results sorted descending by score.
   *
   * @param {string} query
   * @param {object} [options]
   * @param {'bm25'|'tfidf'} [options.mode='bm25']
   * @param {number} [options.topK=5]
   * @param {number} [options.k1=1.2]
   * @param {number} [options.b=0.75]
   * @returns {Array<{ docId: number, score: number }>}
   */
  search(query, options = {}) {
    const mode = options.mode || "bm25";
    const topK = typeof options.topK === "number" ? options.topK : 5;
    const k1 = typeof options.k1 === "number" ? options.k1 : 1.2;
    const b = typeof options.b === "number" ? options.b : 0.75;

    const tokens = this.analyzer.analyze(query);
    const candidates = this.getCandidates(tokens);

    if (candidates.length === 0) {
      return [];
    }

    const scored = candidates.map((docId) => {
      let score = 0;
      if (mode === "bm25") {
        score = this.scoreBM25(tokens, docId, k1, b);
      } else if (mode === "tfidf") {
        score = this.scoreTFIDF(tokens, docId);
      } else {
        throw new Error(`Unknown scoring mode: "${mode}". Use "bm25" or "tfidf".`);
      }
      return { docId, score: Math.round(score * 10000) / 10000 };
    });

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topK);
  }
}
