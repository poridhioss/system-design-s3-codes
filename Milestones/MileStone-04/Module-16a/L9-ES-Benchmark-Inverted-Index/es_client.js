/**
 * es_client.js
 *
 * Industrial Elasticsearch client wrapper for Node.js 20+ LTS.
 * Manages index lifecycle, multi-field analysis schemas, bulk ingestion
 * with Near-Real-Time (NRT) segment visibility, and Lucene BM25 scoring queries.
 */

import { DOCUMENTS } from "./corpus.js";

let Client;
try {
  const esModule = await import("@elastic/elasticsearch");
  Client = esModule.Client;
} catch {
  Client = class FallbackClient {
    constructor() {}
    async info() {
      throw new Error("@elastic/elasticsearch driver is not installed. Run 'npm install'.");
    }
  };
}

export const INDEX_NAME = "dist_sys_corpus";
export const ES_HOST = process.env.ELASTICSEARCH_URL || "http://localhost:9200";

export class ElasticsearchClient {
  /**
   * @param {string} [node] - Target Elasticsearch HTTP URL.
   */
  constructor(node = ES_HOST) {
    this.node = node;
    this.client = new Client({
      node,
      tls: { rejectUnauthorized: false },
      requestTimeout: 10000,
      maxRetries: 3,
    });
  }

  /**
   * Verifies cluster connectivity via ping.
   * @returns {Promise<boolean>}
   */
  async ping() {
    try {
      const info = await this.client.info();
      return !!info;
    } catch {
      return false;
    }
  }

  /**
   * Creates the target index with explicit multi-field analyzer mappings:
   * - standard: unicode word boundary segmentation, strips punctuation
   * - content.english: Porter stemmer + english stopwords
   * - content.exact: pattern tokenizer preserving hyphenated technical compound terms
   *
   * @param {boolean} [recreate=true]
   * @returns {Promise<boolean>}
   */
  async createIndex(recreate = true) {
    const exists = await this.client.indices.exists({ index: INDEX_NAME });
    if (exists) {
      if (recreate) {
        await this.client.indices.delete({ index: INDEX_NAME });
        console.log(`[INDEX] Deleted existing index '${INDEX_NAME}'.`);
      } else {
        console.log(`[INDEX] Index '${INDEX_NAME}' already exists.`);
        return true;
      }
    }

    // Configure single primary shard and multi-field analyzer settings
    const indexBody = {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        analysis: {
          analyzer: {
            custom_hyphen_analyzer: {
              type: "custom",
              tokenizer: "custom_hyphen_tokenizer",
              filter: ["lowercase"],
            },
          },
          tokenizer: {
            custom_hyphen_tokenizer: {
              type: "pattern",
              pattern: "[^a-zA-Z0-9_-]+",
            },
          },
        },
      },
      mappings: {
        properties: {
          doc_id: { type: "integer" },
          title: {
            type: "text",
            analyzer: "standard",
            fields: {
              english: { type: "text", analyzer: "english" },
            },
          },
          content: {
            type: "text",
            analyzer: "standard",
            fields: {
              english: {
                type: "text",
                analyzer: "english",
              },
              exact: {
                type: "text",
                analyzer: "custom_hyphen_analyzer",
              },
            },
          },
        },
      },
    };

    await this.client.indices.create({
      index: INDEX_NAME,
      body: indexBody,
    });

    console.log(`[INDEX] Created index '${INDEX_NAME}' with multi-field mappings.`);
    return true;
  }

  /**
   * Bulk ingests documents from the technical corpus into Elasticsearch.
   *
   * Enforces the Near-Real-Time (NRT) Refresh Gate:
   * Lucene writes documents to an in-memory buffer. Without an explicit refresh or
   * refresh: "wait_for", queries executed immediately will return 0 hits.
   *
   * @param {Array<{ id: number, title: string, content: string }>} [docs=DOCUMENTS]
   * @returns {Promise<number>} Number of successfully indexed documents.
   */
  async indexCorpus(docs = DOCUMENTS) {
    // Prepare bulk operations array: [{ create: ... }, { doc_id, title, content }]
    const operations = docs.flatMap((doc) => [
      { create: { _index: INDEX_NAME, _id: String(doc.id) } },
      {
        doc_id: doc.id,
        title: doc.title,
        content: doc.content,
      },
    ]);

    // Execute bulk ingestion with refresh: "wait_for" to ensure segment visibility
    const bulkResponse = await this.client.bulk({
      refresh: "wait_for",
      operations,
    });

    if (bulkResponse.errors) {
      const erroredItems = bulkResponse.items.filter((item) => item.create && item.create.error);
      console.error("[INGEST ERROR] Bulk errors encountered:", erroredItems);
      throw new Error(`Bulk ingestion failed for ${erroredItems.length} documents.`);
    }

    // Explicit index refresh to commit Lucene segment visibility
    await this.client.indices.refresh({ index: INDEX_NAME });

    const docCount = bulkResponse.items.length;
    console.log(`[INGEST] Successfully indexed ${docCount} documents and committed NRT segments.`);
    return docCount;
  }

  /**
   * Executes a full-text match query on a specified field with Boolean operator.
   *
   * @param {string} query
   * @param {string} [field='content'] - 'content', 'content.english', or 'content.exact'
   * @param {'or'|'and'} [operator='or']
   * @param {number} [topK=10]
   * @returns {Promise<Array<{ doc_id: number, score: number, title: string }>>}
   */
  async search(query, field = "content", operator = "or", topK = 10) {
    const response = await this.client.search({
      index: INDEX_NAME,
      body: {
        query: {
          match: {
            [field]: {
              query,
              operator,
            },
          },
        },
        size: topK,
      },
    });

    const hits = response.hits?.hits || [];
    return hits.map((hit) => ({
      doc_id: hit._source.doc_id,
      score: Math.round(Number(hit._score) * 10000) / 10000,
      title: hit._source.title,
    }));
  }

  /**
   * Fetches Lucene's internal BM25 scoring tree via the _explain API.
   *
   * @param {string} query
   * @param {number} docId
   * @param {string} [field='content.english']
   * @returns {Promise<object>}
   */
  async explain(query, docId, field = "content.english") {
    return await this.client.explain({
      index: INDEX_NAME,
      id: String(docId),
      body: {
        query: {
          match: {
            [field]: query,
          },
        },
      },
    });
  }

  /**
   * Helper to inspect tokenization stream for an arbitrary text string.
   *
   * @param {string} text
   * @param {string} [analyzer='standard']
   * @returns {Promise<string[]>}
   */
  async analyzeTokens(text, analyzer = "standard") {
    const res = await this.client.indices.analyze({
      index: INDEX_NAME,
      body: {
        analyzer,
        text,
      },
    });
    return (res.tokens || []).map((t) => t.token);
  }
}

// Direct CLI execution: node es_client.js creates schema and ingests corpus
if (process.argv[1]?.endsWith("es_client.js")) {
  const client = new ElasticsearchClient();
  const isUp = await client.ping();
  if (!isUp) {
    console.error("[ERROR] Elasticsearch is not reachable at " + ES_HOST);
    console.error("        Please ensure 'docker compose up -d' is running.");
    process.exit(1);
  }

  await client.createIndex(true);
  await client.indexCorpus(DOCUMENTS);
  console.log("[SETUP COMPLETE] Index created and populated.");
}
