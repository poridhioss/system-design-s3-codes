/**
 * homemade_adapter.js
 *
 * Adapter wrapping the custom in-memory Inverted Index and BM25 Search Ranker
 * built in Lab 7. Standardizes search results into uniform tuples compatible
 * with ElasticsearchClient and the Cranfield IREvaluator.
 */

import { TextAnalyzer } from "./TextAnalyzer.js";
import { InvertedIndex } from "./InvertedIndex.js";
import { SearchRanker } from "./SearchRanker.js";
import { DOCUMENTS } from "./corpus.js";

export class HomemadeSearchEngine {
  /**
   * @param {Array<{ id: number, title: string, content: string }>} [documents=DOCUMENTS]
   */
  constructor(documents = DOCUMENTS) {
    this.documents = documents;
    this.analyzer = new TextAnalyzer();
    this.index = new InvertedIndex();
    this._buildIndex();
    this.ranker = new SearchRanker(this.index, this.analyzer);
  }

  /**
   * Populates the in-memory inverted index by analyzing title and content.
   * @private
   */
  _buildIndex() {
    for (const doc of this.documents) {
      const combinedText = `${doc.title} ${doc.content}`;
      const tokens = this.analyzer.analyze(combinedText);
      this.index.addDocument(doc.id, tokens);
    }
  }

  /**
   * Executes candidate retrieval (Boolean AND) and BM25 relevance ranking.
   *
   * Standardizes SearchRanker results into uniform search hit objects:
   * - doc_id: number
   * - score: float
   * - title: string
   * - content_preview: string (first 80 chars)
   *
   * @param {string} query
   * @param {object} [options]
   * @param {number} [options.topK=10]
   * @param {'bm25'|'tfidf'} [options.mode='bm25']
   * @param {number} [options.k1=1.2]
   * @param {number} [options.b=0.75]
   * @returns {Array<{ doc_id: number, score: number, title: string, content_preview: string }>}
   */
  search(query, options = {}) {
    const topK = options.topK ?? 10;
    const mode = options.mode ?? "bm25";
    const k1 = options.k1 ?? 1.2;
    const b = options.b ?? 0.75;

    // Execute candidate retrieval and scoring via Lab 7 SearchRanker
    const rawResults = this.ranker.search(query, {
      mode,
      topK,
      k1,
      b,
    });

    const docMap = new Map(this.documents.map((d) => [d.id, d]));

    // Map raw SearchRanker output { docId, score } to standardized records
    const standardizedResults = [];
    for (const item of rawResults) {
      const doc = docMap.get(item.docId) || {};
      const title = doc.title || `Document #${item.docId}`;
      const content = doc.content || "";
      const preview = content.length > 80 ? content.slice(0, 80) + "..." : content;

      standardizedResults.push({
        doc_id: item.docId,
        score: item.score,
        title,
        content_preview: preview,
      });
    }

    return standardizedResults;
  }

  /**
   * Returns term-by-term BM25 scoring decomposition.
   *
   * @param {string} query
   * @param {number} docId
   * @returns {object}
   */
  explain(query, docId) {
    return this.ranker.explainScore(query, docId);
  }
}

// Direct self-test CLI execution
if (process.argv[1]?.endsWith("homemade_adapter.js")) {
  console.log("================================================================================");
  console.log("  SELF-TEST: HOMEMADE INVERTED INDEX ADAPTER (LAB 7)");
  console.log("================================================================================");

  const engine = new HomemadeSearchEngine();
  console.log(`[*] Corpus Size   : ${engine.index.totalDocs} documents`);
  console.log(`[*] Vocabulary    : ${engine.index.vocabularySize} unique terms`);
  console.log(`[*] Avg Doc Len   : ${engine.index.avgDocLen.toFixed(2)} tokens`);
  console.log("--------------------------------------------------------------------------------");

  const testQueries = [
    "raft consensus leader election",
    "in-memory key-value",
    "replicating cache nodes",
  ];

  for (const q of testQueries) {
    const hits = engine.search(q, { topK: 3 });
    console.log(`Query: '${q}' -> Hits: ${hits.length}`);
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      console.log(`  [${i + 1}] Doc ${h.doc_id}: score=${h.score} - ${h.title}`);
    }
    if (hits.length === 0) {
      console.log("  (0 hits - Boolean AND required all tokens to match)");
    }
  }
}
