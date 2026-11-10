/**
 * dataset.js - Canonical 8-Document Technical Corpus
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
