import test from 'node:test';
import assert from 'node:assert/strict';
import { BitTwiddler } from './BitTwiddler.js';
import { LayoutRegistry } from './LayoutRegistry.js';
import { MonotonicClock } from './MonotonicClock.js';
import { ClockDriftDetector, ClockBackwardSkewError } from './ClockDriftDetector.js';

test('LayoutRegistry - Industry ID Schemas', async (t) => {
  await t.test('should define Twitter Snowflake schema correctly', () => {
    const twitter = LayoutRegistry.TWITTER;
    assert.equal(twitter.totalBits, 64);
    assert.equal(twitter.signBits, 1);
    assert.equal(twitter.timestampBits, 41);
    assert.equal(twitter.workerBits, 10);
    assert.equal(twitter.sequenceBits, 12);
    assert.equal(twitter.epoch, 1288834974657n);
  });

  await t.test('should define Discord Snowflake schema with 42-bit timestamp', () => {
    const discord = LayoutRegistry.DISCORD;
    assert.equal(discord.signBits, 0);
    assert.equal(discord.timestampBits, 42);
    assert.equal(discord.epoch, 1420070400000n);
  });

  await t.test('should define Instagram schema with 13-bit logical shard', () => {
    const insta = LayoutRegistry.INSTAGRAM;
    assert.equal(insta.timestampBits, 41);
    assert.equal(insta.workerBits, 13);
    assert.equal(insta.sequenceBits, 10);
    assert.equal(insta.epoch, 1293840000000n);
  });

  await t.test('should define Sonyflake schema with 39-bit 10ms timestamp and 16-bit machine', () => {
    const sony = LayoutRegistry.SONYFLAKE;
    assert.equal(sony.timestampBits, 39);
    assert.equal(sony.timeUnitMs, 10n);
    assert.equal(sony.workerBits, 16);
    assert.equal(sony.sequenceBits, 8);
  });
});

test('BitTwiddler - Bitmask Math and 64-Bit Packing', async (t) => {
  await t.test('should generate exact bitmasks without overflow', () => {
    assert.equal(BitTwiddler.createMask(1), 1n);
    assert.equal(BitTwiddler.createMask(10), 1023n);
    assert.equal(BitTwiddler.createMask(12), 4095n);
    assert.equal(BitTwiddler.createMask(41), 0x1FFFFFFFFFFn);
  });

  await t.test('should pack and unpack IDs without bit bleeding', () => {
    const layout = LayoutRegistry.TWITTER;
    const input = {
      timestamp: layout.epoch + 100000n,
      workerId: 42n,
      sequence: 100n
    };

    const id = BitTwiddler.pack(input, layout);
    const unpacked = BitTwiddler.unpack(id, layout);

    assert.equal(unpacked.timestamp, input.timestamp);
    assert.equal(unpacked.workerId, input.workerId);
    assert.equal(unpacked.sequence, input.sequence);
    assert.equal(id > 0n, true, 'Bit 63 must remain 0 for signed safety');
  });

  await t.test('should roundtrip Discord layout with 42-bit timestamp', () => {
    const layout = LayoutRegistry.DISCORD;
    const input = {
      timestamp: layout.epoch + 500000n,
      workerId: 15n,
      sequence: 2048n
    };

    const id = BitTwiddler.pack(input, layout);
    const unpacked = BitTwiddler.unpack(id, layout);

    assert.equal(unpacked.timestamp, input.timestamp);
    assert.equal(unpacked.workerId, input.workerId);
    assert.equal(unpacked.sequence, input.sequence);
  });

  await t.test('should roundtrip Instagram layout with 13-bit shard', () => {
    const layout = LayoutRegistry.INSTAGRAM;
    const input = {
      timestamp: layout.epoch + 250000n,
      workerId: 5000n, // Logical shard
      sequence: 512n
    };

    const id = BitTwiddler.pack(input, layout);
    const unpacked = BitTwiddler.unpack(id, layout);

    assert.equal(unpacked.timestamp, input.timestamp);
    assert.equal(unpacked.workerId, input.workerId);
    assert.equal(unpacked.sequence, input.sequence);
  });

  await t.test('should enforce 53-bit precision loss demonstration', () => {
    const maxSafe = Number.MAX_SAFE_INTEGER;
    assert.equal(maxSafe + 1 === maxSafe + 2, true);

    const safeBigInt = BigInt(maxSafe);
    assert.notEqual(safeBigInt + 1n, safeBigInt + 2n);
  });

  await t.test('should throw TypeError on unsigned right shift (>>>) with BigInt', () => {
    assert.throws(
      () => {
        eval('100n >>> 2n');
      },
      TypeError
    );
  });

  await t.test('should generate minimum Snowflake ID for a timestamp range query', () => {
    const layout = LayoutRegistry.TWITTER;
    const targetMs = layout.epoch + 60000n;
    const minId = BitTwiddler.idForTimestamp(targetMs, layout);
    const unpacked = BitTwiddler.unpack(minId, layout);

    assert.equal(unpacked.timestamp, targetMs);
    assert.equal(unpacked.workerId, 0n);
    assert.equal(unpacked.sequence, 0n);
  });

  await t.test('should serialize to string and deserialize back without loss', () => {
    const id = 1732456789123456789n;
    const str = BitTwiddler.serialize(id);
    assert.equal(typeof str, 'string');
    assert.equal(BitTwiddler.deserialize(str), id);
  });
});

test('ClockDriftDetector - Handling Backward Clock Skew', async (t) => {
  const detector = new ClockDriftDetector({ toleranceMs: 5n });

  await t.test('should allow normal forward ticks without pause', () => {
    const res = detector.check(1000n, 999n);
    assert.equal(res.action, 'PROCEED');
    assert.equal(res.skewMs, 0n);
  });

  await t.test('should tolerate minor backward skew by pausing', () => {
    const res = detector.check(998n, 1000n);
    assert.equal(res.action, 'PAUSE_AND_WAIT');
    assert.equal(res.skewMs, 2n);
  });

  await t.test('should throw ClockBackwardSkewError when skew exceeds tolerance threshold', () => {
    assert.throws(
      () => detector.check(900n, 1000n),
      (err) => err instanceof ClockBackwardSkewError && err.skewMs === 100n
    );
  });
});

test('MonotonicClock - Forward Hardware Timing', async (t) => {
  const clock = new MonotonicClock();

  await t.test('should return monotonic milliseconds that never decrease', () => {
    let prev = clock.nowMs();
    for (let i = 0; i < 1000; i++) {
      const curr = clock.nowMs();
      assert.equal(curr >= prev, true);
      prev = curr;
    }
  });

  await t.test('should return raw hardware nanoseconds using process.hrtime.bigint', () => {
    const ns = clock.nowNs();
    assert.equal(typeof ns, 'bigint');
    assert.equal(ns > 0n, true);
  });

  await t.test('should spin-wait until the next millisecond', () => {
    const startMs = clock.nowMs();
    const nextMs = clock.waitUntilNextMs(startMs);
    assert.equal(nextMs > startMs, true);
  });
});
