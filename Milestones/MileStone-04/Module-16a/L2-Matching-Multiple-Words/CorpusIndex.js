/**
 * CorpusIndex.js
 *
 * Ingests the 8-document distributed systems corpus, tokenizes content
 * using the Lab 1 text normalization pipeline, and builds an in-memory
 * dictionary of SortedPostingList instances for Boolean query processing.
 */

import { SortedPostingList, TwoPointerIntersector } from "./PostingList.js";

/**
 * Standard 8-document technical corpus (identical across Module 16a).
 */
export const CORPUS = [
  {
    id: 1,
    title: "Distributed Consensus and the Raft Algorithm",
    body: "Raft is a distributed consensus algorithm designed to be understandable! It solves consensus by electing a distinguished leader, giving the leader complete responsibility for managing the replicated log.",
  },
  {
    id: 2,
    title: "Paxos Made Simple: Distributed Agreement Protocols",
    body: "The Paxos protocol guarantees safety in asynchronous networks despite node crashes and network partitions. Multi-Paxos optimizes the protocol by electing a stable leader for committing log entries.",
  },
  {
    id: 3,
    title: "In-Memory Caching Strategies with Redis and Memcached",
    body: "Redis is an in-memory data structure store used as a distributed cache, message broker, and database! It provides sub-millisecond read latency for high-throughput web applications with persistent storage options.",
  },
  {
    id: 4,
    title: "Log-Structured Merge-Trees in Modern Storage Engines",
    body: "LSM trees optimize write throughput by converting random disk writes into sequential append-only operations. Storage engines like RocksDB and Cassandra use write-ahead logs, memtables, and background compaction.",
  },
  {
    id: 5,
    title: "Consistent Hashing and Dynamic Partitioning in Distributed Key-Value Stores",
    body: "Consistent hashing minimizes key redistribution when cache cluster nodes are added or removed! Distributed hash rings enable horizontal scalability across thousands of storage nodes with virtual nodes.",
  },
  {
    id: 6,
    title: "Vector Embeddings and Semantic Similarity Search",
    body: "Vector search transforms unstructured text into dense mathematical embeddings using deep neural networks. Approximate Nearest Neighbor algorithms like HNSW enable semantic search across billions of vectors.",
  },
  {
    id: 7,
    title: "High-Performance Typeahead Suggestions Using Trie Data Structures",
    body: "Predictive autocomplete engines rely on in-memory prefix trees (Tries) and binary min-heaps to serve search query suggestions in under fifty milliseconds, querying prefixes before full-text retrieval.",
  },
  {
    id: 8,
    title: "Reliability Engineering: Circuit Breakers and Bulkheads in Microservices",
    body: "Distributed systems must prevent cascading network failures! Circuit breakers monitor downstream RPC call errors, tripping into an open state to protect upstream services from thread pool exhaustion.",
  },
];

/**
 * Common English stop words set (identical to Lab 1).
 */
const DEFAULT_STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but",
  "by", "could", "did", "do", "does", "doing", "down", "during", "each", "few", "for", "from",
  "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him",
  "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just", "me",
  "more", "most", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or",
  "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "she", "should",
  "so", "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves", "then",
  "there", "these", "they", "this", "those", "through", "to", "too", "under", "until", "up",
  "very", "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why",
  "with", "would", "you", "your", "yours", "yourself", "yourselves",
]);

/**
 * Pure helper function to tokenize text matching Lab 1's 5-stage pipeline:
 * 1. Lowercase
 * 2. Unicode Punctuation Stripping
 * 3. Whitespace Splitting
 * 4. Stop-word Removal
 * 5. Deterministic Suffix Stripping
 *
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeText(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return [];
  }

  // 1 & 2: Lowercase and strip punctuation
  const clean = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim();

  if (!clean) return [];

  // 3: Split on whitespace
  const rawTokens = clean.split(/\s+/);
  const result = [];

  for (const raw of rawTokens) {
    if (raw.length < 2) continue;
    if (DEFAULT_STOPWORDS.has(raw)) continue;

    // 5: Rule-based Suffix Stripping
    let word = raw;
    if (word.length > 4) {
      if (word.endsWith("ing")) {
        word = word.slice(0, -3);
      } else if (word.endsWith("ed")) {
        word = word.slice(0, -2);
      } else if (word.endsWith("ies") && word.length > 4) {
        word = word.slice(0, -3) + "y";
      } else if (/(?:[xz]|[cs]h)es$/.test(word)) {
        word = word.slice(0, -2);
      } else if (word.endsWith("ss") || word.endsWith("us") || word.endsWith("is")) {
        // Preserve root words ending in double-s ("process") and Latin/Greek roots ("consensus", "status")
      } else if (word.endsWith("s")) {
        word = word.slice(0, -1);
      }
    }

    result.push(word);
  }

  return result;
}

/**
 * Manages corpus ingestion, inverted posting lists, and multi-term Boolean retrieval.
 */
export class CorpusIndex {
  constructor() {
    /** @type {Map<string, SortedPostingList>} */
    this.postings = new Map();
    /** @type {Map<number, { id: number, title: string, body: string }>} */
    this.documents = new Map();
    this.totalIndexedDocs = 0;
  }

  /**
   * Ingests a collection of documents in strictly ascending Document ID order.
   *
   * @param {Array<{ id: number, title: string, body: string }>} corpus
   */
  buildIndex(corpus = CORPUS) {
    // Sort corpus by ID to enforce monotonic ingestion invariant
    const sortedDocs = [...corpus].sort((a, b) => a.id - b.id);

    for (const doc of sortedDocs) {
      this.documents.set(doc.id, doc);
      this.totalIndexedDocs++;

      const fullText = `${doc.title} ${doc.body}`;
      const tokens = tokenizeText(fullText);

      // Count term frequencies within this document
      const tfMap = new Map();
      for (const token of tokens) {
        tfMap.set(token, (tfMap.get(token) || 0) + 1);
      }

      // Add to each term's posting list
      for (const [term, tf] of tfMap.entries()) {
        if (!this.postings.has(term)) {
          this.postings.set(term, new SortedPostingList(term));
        }
        this.postings.get(term).add(doc.id, tf);
      }
    }
  }

  /**
   * Retrieves the SortedPostingList for a specific vocabulary term.
   *
   * @param {string} term
   * @returns {SortedPostingList | undefined}
   */
  getPostingList(term) {
    const tokens = tokenizeText(term);
    if (tokens.length === 0) return undefined;
    return this.postings.get(tokens[0]);
  }

  /**
   * Executes a multi-term Boolean AND search.
   * Evaluates terms using the Shortest-List-First two-pointer merge.
   *
   * @param {string} queryString - Raw query string (e.g. "distributed consensus").
   * @returns {{
   *   query: string,
   *   terms: string[],
   *   matchedDocIds: number[],
   *   matchedDocuments: Array<{ id: number, title: string }>,
   *   operations: number
   * }}
   */
  searchBooleanAnd(queryString) {
    const queryTerms = tokenizeText(queryString);
    if (queryTerms.length === 0) {
      return {
        query: queryString,
        terms: [],
        matchedDocIds: [],
        matchedDocuments: [],
        operations: 0,
      };
    }

    // Retrieve posting lists for each query term
    const lists = [];
    for (const term of queryTerms) {
      const postingList = this.postings.get(term);
      if (!postingList) {
        // Term does not exist in vocabulary: Boolean AND immediately yields empty set!
        return {
          query: queryString,
          terms: queryTerms,
          matchedDocIds: [],
          matchedDocuments: [],
          operations: 0,
        };
      }
      lists.push(postingList);
    }

    // Intersect using Shortest-List-First TwoPointerIntersector
    const { matches, totalOperations } = TwoPointerIntersector.intersectMulti(lists);

    const matchedDocuments = matches.map((id) => {
      const doc = this.documents.get(id);
      return { id: doc.id, title: doc.title };
    });

    return {
      query: queryString,
      terms: queryTerms,
      matchedDocIds: matches,
      matchedDocuments,
      operations: totalOperations,
    };
  }

  /**
   * Returns corpus document by ID.
   * @param {number} docId
   * @returns {{ id: number, title: string, body: string } | undefined}
   */
  getDocument(docId) {
    return this.documents.get(docId);
  }
}
