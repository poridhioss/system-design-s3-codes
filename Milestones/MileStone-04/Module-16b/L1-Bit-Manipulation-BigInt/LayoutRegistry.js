/**
 * LayoutRegistry defines canonical 64-bit ID schemas across major tech stacks.
 * All bit lengths are stored as integers; epoch and unit offsets are BigInts.
 */
export const LayoutRegistry = Object.freeze({
  TWITTER: Object.freeze({
    name: 'Twitter Snowflake',
    totalBits: 64,
    signBits: 1,
    timestampBits: 41,
    workerBits: 10,
    sequenceBits: 12,
    epoch: 1288834974657n, // Nov 4, 2010 01:42:54.657 UTC
    timeUnitMs: 1n,
    maxWorkers: 1024n,
    maxSequence: 4096n,
    timestampShift: 22n, // workerBits (10) + sequenceBits (12)
    workerShift: 12n     // sequenceBits (12)
  }),

  DISCORD: Object.freeze({
    name: 'Discord Snowflake',
    totalBits: 64,
    signBits: 0,
    timestampBits: 42,
    workerBits: 10, // 5 bits worker + 5 bits process
    sequenceBits: 12,
    epoch: 1420070400000n, // Jan 1, 2015 00:00:00.000 UTC
    timeUnitMs: 1n,
    maxWorkers: 1024n,
    maxSequence: 4096n,
    timestampShift: 22n,
    workerShift: 12n
  }),

  INSTAGRAM: Object.freeze({
    name: 'Instagram Sharded Postgres',
    totalBits: 64,
    signBits: 0,
    timestampBits: 41,
    workerBits: 13, // 13 bits logical shard
    sequenceBits: 10,
    epoch: 1293840000000n, // Jan 1, 2011 00:00:00.000 UTC
    timeUnitMs: 1n,
    maxWorkers: 8192n,
    maxSequence: 1024n,
    timestampShift: 23n, // 13 + 10
    workerShift: 10n
  }),

  SONYFLAKE: Object.freeze({
    name: 'Sonyflake',
    totalBits: 64,
    signBits: 1,
    timestampBits: 39,
    workerBits: 16,
    sequenceBits: 8,
    epoch: 1735689600000n, // Jan 1, 2025 00:00:00.000 UTC
    timeUnitMs: 10n, // 10ms ticks
    maxWorkers: 65536n,
    maxSequence: 256n,
    timestampShift: 24n, // 16 + 8
    workerShift: 8n
  })
});
