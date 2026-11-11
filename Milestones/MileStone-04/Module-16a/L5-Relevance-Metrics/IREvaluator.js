import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class SearchEvaluator {
  constructor(judgmentsPath = null) {
    this.judgmentsPath = judgmentsPath || path.join(__dirname, "relevance_judgments.json");
    this.data = JSON.parse(fs.readFileSync(this.judgmentsPath, "utf-8"));
    this.queriesMap = new Map();
    this.queryIdMap = new Map();

    for (const q of this.data.queries || []) {
      this.queriesMap.set(q.query, q);
      this.queryIdMap.set(q.query_id, q);
    }
  }

  getRelevantDocs(query, minGrade = 1) {
    const entry = this.queriesMap.get(query) || this.queryIdMap.get(query);
    if (!entry || !entry.judgments) return new Set();

    const relevant = new Set();
    for (const j of entry.judgments) {
      if ((j.grade ?? 0) >= minGrade) relevant.add(j.doc_id);
    }
    return relevant;
  }

  static precisionAtK(retrieved, relevant, k) {
    if (k <= 0 || !retrieved || retrieved.length === 0) return 0.0;
    const topK = retrieved.slice(0, k);
    let hits = 0;
    for (const docId of topK) {
      if (relevant.has(docId)) hits += 1;
    }
    return Math.round((hits / k) * 10000) / 10000;
  }

  static recallAtK(retrieved, relevant, k) {
    if (!relevant || relevant.size === 0 || k <= 0 || !retrieved || retrieved.length === 0) {
      return 0.0;
    }
    const topK = retrieved.slice(0, k);
    let hits = 0;
    for (const docId of topK) {
      if (relevant.has(docId)) hits += 1;
    }
    return Math.round((hits / relevant.size) * 10000) / 10000;
  }

  static reciprocalRank(retrieved, relevant) {
    if (!relevant || relevant.size === 0 || !retrieved || retrieved.length === 0) return 0.0;
    for (let i = 0; i < retrieved.length; i++) {
      if (relevant.has(retrieved[i])) {
        return Math.round((1.0 / (i + 1)) * 10000) / 10000;
      }
    }
    return 0.0;
  }

  static averagePrecision(retrieved, relevant) {
    if (!relevant || relevant.size === 0 || !retrieved || retrieved.length === 0) return 0.0;
    let hits = 0, sumPrecisions = 0.0;

    for (let i = 0; i < retrieved.length; i++) {
      const rank = i + 1;
      if (relevant.has(retrieved[i])) {
        hits += 1;
        sumPrecisions += hits / rank;
      }
    }
    if (hits === 0) return 0.0;
    return Math.round((sumPrecisions / relevant.size) * 10000) / 10000;
  }

  evaluateRetrieval(query, retrieved, kValues = [1, 3, 5], minGrade = 1) {
    const relevant = this.getRelevantDocs(query, minGrade);
    const metrics = {
      query, retrievedCount: retrieved.length, relevantCount: relevant.size,
      retrievedDocIds: retrieved, relevantDocIds: Array.from(relevant).sort((a, b) => a - b),
      reciprocalRank: SearchEvaluator.reciprocalRank(retrieved, relevant),
      averagePrecision: SearchEvaluator.averagePrecision(retrieved, relevant),
    };

    for (const k of kValues) {
      metrics[`precision@${k}`] = SearchEvaluator.precisionAtK(retrieved, relevant, k);
      metrics[`recall@${k}`] = SearchEvaluator.recallAtK(retrieved, relevant, k);
    }
    return metrics;
  }

  aggregateSuite(queryMetrics) {
    if (!queryMetrics || queryMetrics.length === 0) return {};
    const n = queryMetrics.length;
    let totalAP = 0.0, totalRR = 0.0;

    for (const m of queryMetrics) {
      totalAP += m.averagePrecision || 0.0;
      totalRR += m.reciprocalRank || 0.0;
    }

    const summary = {
      queryCount: n,
      meanAveragePrecision: Math.round((totalAP / n) * 10000) / 10000,
      meanReciprocalRank: Math.round((totalRR / n) * 10000) / 10000,
    };

    const sample = queryMetrics[0];
    for (const key of Object.keys(sample)) {
      if (key.startsWith("precision@") || key.startsWith("recall@")) {
        let total = 0.0;
        for (const m of queryMetrics) total += m[key] || 0.0;
        summary[`mean_${key}`] = Math.round((total / n) * 10000) / 10000;
      }
    }
    return summary;
  }
}
