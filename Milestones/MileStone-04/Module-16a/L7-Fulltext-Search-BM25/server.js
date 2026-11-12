/**
 * server.js
 *
 * Production Full-Text Search HTTP Microservice.
 * Exposes REST endpoints for full-text search with BM25 ranking,
 * Elasticsearch-style score explainability, and document inspection.
 */

import { TextAnalyzer } from "./TextAnalyzer.js";
import { InvertedIndex } from "./InvertedIndex.js";
import { SearchRanker } from "./SearchRanker.js";
import { SnippetHighlighter } from "./SnippetHighlighter.js";
import { DOCUMENTS, DOCUMENTS_BY_ID } from "./corpus.js";

// Initialize Search Engine
const analyzer = new TextAnalyzer();
const index = new InvertedIndex();

// Ingest corpus documents
for (const doc of DOCUMENTS) {
  const tokens = analyzer.analyze(`${doc.title} ${doc.content}`);
  index.addDocument(doc.id, tokens);
}

const ranker = new SearchRanker(index, analyzer);

export { analyzer, index, ranker };

/**
 * Request handler logic for both Express and native HTTP.
 */
export function handleSearch(query, options = {}) {
  const start = performance.now();
  const mode = options.mode || "bm25";
  const limit = parseInt(options.limit, 10) || 5;
  const k1 = options.k1 ? parseFloat(options.k1) : 1.2;
  const b = options.b ? parseFloat(options.b) : 0.75;

  const results = ranker.search(query, { mode, topK: limit, k1, b });
  const queryTokens = analyzer.analyze(query);

  const enriched = results.map(({ docId, score }) => {
    const doc = DOCUMENTS_BY_ID.get(docId);
    return {
      docId,
      score,
      title: doc ? doc.title : "Unknown",
      snippet: doc ? SnippetHighlighter.highlight(doc.content, queryTokens, 8) : "",
    };
  });

  const tookMs = Math.round((performance.now() - start) * 100) / 100;

  return {
    query,
    mode,
    totalHits: enriched.length,
    tookMs,
    hits: enriched,
  };
}

export function handleExplain(query, docIdStr, options = {}) {
  const docId = parseInt(docIdStr, 10);
  if (isNaN(docId) || !DOCUMENTS_BY_ID.has(docId)) {
    return { error: `Document ID ${docIdStr} not found.` };
  }

  const k1 = options.k1 ? parseFloat(options.k1) : 1.2;
  const b = options.b ? parseFloat(options.b) : 0.75;

  const explanation = ranker.explainScore(query, docId, k1, b);
  const doc = DOCUMENTS_BY_ID.get(docId);

  return {
    query,
    docId,
    title: doc ? doc.title : "Unknown",
    explanation,
  };
}

export function handleHealth() {
  return {
    status: "healthy",
    engine: "InvertedIndex-BM25",
    totalDocs: index.totalDocs,
    vocabularySize: index.vocabularySize,
    avgDocLen: Math.round(index.avgDocLen * 100) / 100,
  };
}

// Start HTTP Server
const PORT = process.env.PORT || 3001;

async function bootstrap() {
  try {
    // Attempt standard Express startup
    const expressModule = await import("express");
    const express = expressModule.default;
    const app = express();

    app.get("/health", (req, res) => {
      res.json(handleHealth());
    });

    app.get("/search", (req, res) => {
      const q = req.query.q;
      if (!q) {
        return res.status(400).json({ error: 'Query parameter "q" is required.' });
      }
      res.json(handleSearch(q, req.query));
    });

    app.get("/explain", (req, res) => {
      const { q, docId } = req.query;
      if (!q || !docId) {
        return res.status(400).json({ error: 'Parameters "q" and "docId" are required.' });
      }
      const result = handleExplain(q, docId, req.query);
      if (result.error) return res.status(404).json(result);
      res.json(result);
    });

    app.get("/corpus", (req, res) => {
      res.json({
        total: DOCUMENTS.length,
        documents: DOCUMENTS.map((d) => ({
          id: d.id,
          title: d.title,
          tokenCount: index.getDocLen(d.id),
        })),
      });
    });

    const server = app.listen(PORT, () => {
      console.log(`[Search API] Express server running at http://localhost:${PORT}`);
    });
    return server;
  } catch {
    // Graceful fallback to native node:http when running in an offline environment
    const http = await import("node:http");
    const { URL } = await import("node:url");

    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
      const pathname = parsedUrl.pathname;
      const params = Object.fromEntries(parsedUrl.searchParams.entries());

      res.setHeader("Content-Type", "application/json");

      if (pathname === "/health") {
        res.writeHead(200);
        return res.end(JSON.stringify(handleHealth(), null, 2));
      }

      if (pathname === "/search") {
        const q = params.q;
        if (!q) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Query parameter "q" is required.' }));
        }
        res.writeHead(200);
        return res.end(JSON.stringify(handleSearch(q, params), null, 2));
      }

      if (pathname === "/explain") {
        const { q, docId } = params;
        if (!q || !docId) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: 'Parameters "q" and "docId" are required.' }));
        }
        const result = handleExplain(q, docId, params);
        res.writeHead(result.error ? 404 : 200);
        return res.end(JSON.stringify(result, null, 2));
      }

      if (pathname === "/corpus") {
        res.writeHead(200);
        return res.end(
          JSON.stringify(
            {
              total: DOCUMENTS.length,
              documents: DOCUMENTS.map((d) => ({
                id: d.id,
                title: d.title,
                tokenCount: index.getDocLen(d.id),
              })),
            },
            null,
            2
          )
        );
      }

      res.writeHead(404);
      return res.end(JSON.stringify({ error: "Endpoint not found" }));
    });

    server.listen(PORT, () => {
      console.log(`[Search API] Native HTTP server running at http://localhost:${PORT}`);
    });
    return server;
  }
}

// Only auto-start if executed directly
if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  bootstrap();
}
