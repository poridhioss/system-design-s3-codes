export class ClockBackwardSkewError extends Error {
  constructor(skewMs, lastMs, currentMs) {
    super(`System clock stepped backward by ${skewMs} ms! (last: ${lastMs}, current: ${currentMs}). Halting to prevent duplicate keys.`);
    this.name = 'ClockBackwardSkewError';
    this.skewMs = skewMs;
    this.lastMs = lastMs;
    this.currentMs = currentMs;
  }
}

/**
 * ClockDriftDetector guards against backward NTP step corrections,
 * enforcing production safety policies (tolerate micro-drift vs fail fast).
 */
export class ClockDriftDetector {
  constructor({ toleranceMs = 5n } = {}) {
    this.toleranceMs = BigInt(toleranceMs);
  }

  /**
   * Evaluates current system time against the last recorded timestamp.
   */
  check(currentMs, lastMs) {
    const curr = BigInt(currentMs);
    const last = BigInt(lastMs);

    if (curr >= last) {
      return { action: 'PROCEED', timestamp: curr, skewMs: 0n };
    }

    const skewMs = last - curr;

    if (skewMs <= this.toleranceMs) {
      return {
        action: 'PAUSE_AND_WAIT',
        timestamp: last,
        skewMs
      };
    }

    throw new ClockBackwardSkewError(skewMs, last, curr);
  }
}
