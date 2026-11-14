/**
 * esClient.js
 *
 * Industrial Elasticsearch client wrapper for Node.js 20+ LTS.
 * Manages index lifecycle, multi-field analysis schemas, bulk ingestion
 * with Near-Real-Time (NRT) segment visibility, and Lucene BM25 scoring queries.
 *
 * Transparently supports both the official '@elastic/elasticsearch' driver
 * and native Node.js HTTP/fetch REST fallback.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOCUMENTS } from "./corpus.js";

let Client;
try {
  const esModule = await import("@elastic/elasticsearch");
  Client = esModule.Client;
} catch {
  // Built-in lightweight REST client using native Node.js fetch
  Client = class RestElasticsearchClient {
    constructor({ node, requestTimeout = 5000 }) {
      this.node = (node || "http://localhost:9200").replace(/\/$/, "");
      this.requestTimeout = requestTimeout;
    }

    async info() {
      const res = await fetch(`${this.node}/`, { signal: AbortSignal.timeout(this.requestTimeout) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    }

    get cluster() {
      return {
        health: async () => {
          const res = await fetch(`${this.node}/_cluster/health`, { signal: AbortSignal.timeout(this.requestTimeout) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.json();
        },
      };
    }

    get indices() {
      return {
        exists: async ({ index }) => {
          const res = await fetch(`${this.node}/${index}`, { method: "HEAD", signal: AbortSignal.timeout(this.requestTimeout) });
          return res.status === 200;
        },
        delete: async ({ index }) => {
          const res = await fetch(`${this.node}/${index}`, { method: "DELETE", signal: AbortSignal.timeout(this.requestTimeout) });
          return await res.json();
        },
        create: async ({ index, body }) => {
          const res = await fetch(`${this.node}/${index}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.requestTimeout),
          });
          return await res.json();
        },
        refresh: async ({ index }) => {
          const res = await fetch(`${this.node}/${index}/_refresh`, { method: "POST", signal: AbortSignal.timeout(this.requestTimeout) });
          return await res.json();
        },
      };
    }

    async bulk({ refresh, operations }) {
      let ndjson = "";
      for (let i = 0; i < operations.length; i += 2) {
        ndjson += JSON.stringify(operations[i]) + "\n" + JSON.stringify(operations[i + 1]) + "\n";
      }
      const url = `${this.node}/_bulk${refresh ? "?refresh=" + refresh : ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-ndjson" },
        body: ndjson,
        signal: AbortSignal.timeout(this.requestTimeout),
      });
      return await res.json();
    }

    async search({ index, body }) {
      const res = await fetch(`${this.node}/${index}/_search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.requestTimeout),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
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
   * Creates the target index with explicit multi-field analyzer mappings.
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
   * @param {Array<{ id: number, title: string, content: string }>} [docs=DOCUMENTS]
   * @returns {Promise<number>} Number of successfully indexed documents.
   */
  async indexCorpus(docs = DOCUMENTS) {
    const operations = docs.flatMap((doc) => [
      { create: { _index: INDEX_NAME, _id: String(doc.id) } },
      {
        doc_id: doc.id,
        title: doc.title,
        content: doc.content,
      },
    ]);

    const bulkResponse = await this.client.bulk({
      refresh: "wait_for",
      operations,
    });

    if (bulkResponse.errors) {
      const erroredItems = bulkResponse.items.filter((item) => item.create && item.create.error);
      console.error("[INGEST ERROR] Bulk errors encountered:", erroredItems);
      throw new Error(`Bulk ingestion failed for ${erroredItems.length} documents.`);
    }

    await this.client.indices.refresh({ index: INDEX_NAME });
    const docCount = bulkResponse.items.length;
    console.log(`[INGEST] Successfully indexed ${docCount} documents and committed NRT segments.`);
    return docCount;
  }

  /**
   * Executes a full-text match query on a specified field with Boolean operator.
   * Supports either positional arguments: (query, field, operator, topK)
   * or options object: ({ query, field, operator, topK }).
   *
   * @param {string|object} queryOrOptions
   * @param {string} [field='content.english']
   * @param {'or'|'and'} [operator='or']
   * @param {number} [topK=10]
   * @returns {Promise<Array<{ doc_id: number, score: number, title: string }>>}
   */
  async search(queryOrOptions, field = "content.english", operator = "or", topK = 10) {
    let q = queryOrOptions;
    let targetField = field;
    let targetOperator = operator;
    let targetTopK = topK;

    if (typeof queryOrOptions === "object" && queryOrOptions !== null) {
      q = queryOrOptions.query;
      targetField = queryOrOptions.field || field;
      targetOperator = queryOrOptions.operator || operator;
      targetTopK = typeof queryOrOptions.topK === "number" ? queryOrOptions.topK : topK;
    }

    const response = await this.client.search({
      index: INDEX_NAME,
      body: {
        query: {
          match: {
            [targetField]: {
              query: q,
              operator: targetOperator,
            },
          },
        },
        size: targetTopK,
      },
    });

    const hits = response.hits?.hits || [];
    return hits.map((hit) => ({
      doc_id: hit._source.doc_id,
      score: Math.round(Number(hit._score) * 10000) / 10000,
      title: hit._source.title,
    }));
  }
}

// Direct CLI execution: node esClient.js creates schema and seeds corpus
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("esClient.js") ||
    (import.meta.url && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])));

if (isMain) {
  console.log(`[INIT] Connecting to Elasticsearch at ${ES_HOST}...`);
  const client = new ElasticsearchClient();
  const isUp = await client.ping();
  if (!isUp) {
    console.error(`[ERROR] Elasticsearch is not reachable at ${ES_HOST}`);
    console.error("        Please ensure 'docker compose up -d' is running and container is healthy.");
    process.exit(1);
  }

  console.log("[SUCCESS] Connected to Elasticsearch cluster.");
  await client.createIndex(true);
  await client.indexCorpus(DOCUMENTS);
  console.log(`[SETUP COMPLETE] Index '${INDEX_NAME}' created and technical corpus seeded.`);
}
