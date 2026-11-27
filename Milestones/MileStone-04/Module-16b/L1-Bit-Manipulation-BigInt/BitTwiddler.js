/**
 * BitTwiddler provides deterministic 64-bit binary packing, masking,
 * and serialization utilities for distributed unique identifiers.
 */
export class BitTwiddler {
  /**
   * Creates an unsigned bitmask of width n.
   * Example: createMask(12) => (1n << 12n) - 1n = 4095n (0xFFFn)
   */
  static createMask(bits) {
    return (1n << BigInt(bits)) - 1n;
  }

  /**
   * Packs timestamp, worker ID, and sequence counter into a 64-bit BigInt.
   */
  static pack({ timestamp, workerId, sequence }, layout) {
    const epochTime = BigInt(timestamp) - layout.epoch;
    if (epochTime < 0n) {
      throw new RangeError(`Timestamp ${timestamp} is earlier than epoch ${layout.epoch}`);
    }

    const maxTimestamp = this.createMask(layout.timestampBits);
    const maxWorker = this.createMask(layout.workerBits);
    const maxSequence = this.createMask(layout.sequenceBits);

    // Apply strict bitmasks to prevent carry contamination into adjacent fields
    const maskedTime = (epochTime / layout.timeUnitMs) & maxTimestamp;
    const maskedWorker = BigInt(workerId) & maxWorker;
    const maskedSeq = BigInt(sequence) & maxSequence;

    let packed = (maskedTime << layout.timestampShift) |
                 (maskedWorker << layout.workerShift) |
                 maskedSeq;

    if (layout.signBits === 1) {
      // Ensure bit 63 is strictly 0 (positive signed 64-bit integer)
      packed = packed & ~(1n << 63n);
    }

    return packed;
  }

  /**
   * Unpacks a 64-bit Snowflake ID into its constituent components.
   */
  static unpack(id, layout) {
    const rawId = BigInt(id);
    const maxTimestamp = this.createMask(layout.timestampBits);
    const maxWorker = this.createMask(layout.workerBits);
    const maxSequence = this.createMask(layout.sequenceBits);

    const maskedSeq = rawId & maxSequence;
    const maskedWorker = (rawId >> layout.workerShift) & maxWorker;
    const maskedTime = (rawId >> layout.timestampShift) & maxTimestamp;

    const absoluteTimestamp = (maskedTime * layout.timeUnitMs) + layout.epoch;

    return {
      timestamp: absoluteTimestamp,
      workerId: maskedWorker,
      sequence: maskedSeq
    };
  }

  /**
   * Generates the synthetic minimum possible Snowflake ID for a given timestamp.
   * Used for index range scans without maintaining secondary timestamp columns.
   * SQL: WHERE id >= :minId AND id < :maxId
   */
  static idForTimestamp(timestampMs, layout) {
    const epochTime = BigInt(timestampMs) - layout.epoch;
    const maskedTime = (epochTime / layout.timeUnitMs) & this.createMask(layout.timestampBits);
    return maskedTime << layout.timestampShift;
  }

  /**
   * Safely formats a 64-bit BigInt as a JSON-safe string to prevent client-side float rounding.
   */
  static serialize(id) {
    return id.toString();
  }

  /**
   * Parses a string representation back into a BigInt.
   */
  static deserialize(str) {
    return BigInt(str);
  }
}
