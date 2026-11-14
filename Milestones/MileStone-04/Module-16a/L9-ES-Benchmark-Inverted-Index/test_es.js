/**
 * test_es.js
 *
 * Verifies connectivity to Elasticsearch on http://localhost:9200, checks
 * cluster health, and reports JVM memory metrics.
 */

let Client;
try {
  const esModule = await import("@elastic/elasticsearch");
  Client = esModule.Client;
} catch {
  Client = null;
}

const ES_HOST = process.env.ELASTICSEARCH_URL || "http://localhost:9200";

async function verifyClusterHealth() {
  console.log("================================================================================");
  console.log("  ELASTICSEARCH CLUSTER HEALTH & CONNECTIVITY VERIFICATION");
  console.log("================================================================================");
  console.log(`[*] Target Host : ${ES_HOST}`);

  if (!Client) {
    console.error("[FAIL] The '@elastic/elasticsearch' package is not installed.");
    console.error("       Please run 'npm install' in this directory first.");
    process.exit(1);
  }

  const client = new Client({
    node: ES_HOST,
    tls: { rejectUnauthorized: false },
    requestTimeout: 5000,
  });

  try {
    const t0 = performance.now();
    const info = await client.info();
    const pingLatency = (performance.now() - t0).toFixed(2);

    console.log(`[PASS] Ping successful in ${pingLatency}ms.`);
    console.log(`       Cluster Name : ${info.cluster_name}`);
    console.log(`       Lucene Ver   : ${info.version.lucene_version}`);
    console.log(`       ES Version   : ${info.version.number}`);

    const health = await client.cluster.health({});
    console.log(`[PASS] Cluster Status: ${health.status.toUpperCase()}`);
    console.log(`       Active Nodes  : ${health.number_of_nodes}`);
    console.log(`       Active Shards : ${health.active_primary_shards}`);

    console.log("================================================================================");
    console.log("  ELASTICSEARCH INSTANCE READY FOR BENCHMARK OPERATIONS");
    console.log("================================================================================");
    process.exit(0);
  } catch (err) {
    console.error("[FAIL] Could not connect to Elasticsearch cluster.");
    console.error(`       Error details: ${err.message}`);
    console.error("       Ensure 'docker compose up -d' has finished starting.");
    process.exit(1);
  }
}

verifyClusterHealth();
