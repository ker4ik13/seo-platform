/**
 * Allocates deterministic, non-overlapping BullMQ tick identifiers to every
 * connector process. Provider quota buckets remain the authoritative limit;
 * this only lets the configured worker pool feed them without processes
 * collapsing onto the same deduplicated queue jobs.
 */
export function shardedDispatchSequence(
  dispatchBucket: number,
  localBurst: number,
  shardIndex: number,
  shardCount: number,
  slot: number
): number {
  if (
    ![dispatchBucket, localBurst, shardIndex, shardCount, slot].every(
      Number.isSafeInteger
    ) ||
    dispatchBucket < 0 ||
    localBurst < 1 ||
    shardCount < 1 ||
    shardIndex < 0 ||
    shardIndex >= shardCount ||
    slot < 0 ||
    slot >= localBurst
  ) {
    throw new TypeError("Invalid connector runtime dispatch shard");
  }
  const sequence =
    dispatchBucket * localBurst * shardCount +
    shardIndex * localBurst +
    slot;
  if (!Number.isSafeInteger(sequence)) {
    throw new TypeError("Connector runtime dispatch sequence overflow");
  }
  return sequence;
}

/**
 * Keep one cheap probe per shard while idle and open the full pool as soon as
 * any shard observes real work. The fixed sequence stride remains the full
 * burst size, so switching modes cannot collide BullMQ job identifiers.
 */
export function adaptiveRankDispatchBurst(
  concurrency: number,
  activeUntil: number,
  now: number
): number {
  if (
    !Number.isSafeInteger(concurrency) ||
    concurrency < 1 ||
    !Number.isFinite(activeUntil) ||
    !Number.isFinite(now)
  ) {
    throw new TypeError("Invalid adaptive rank dispatch state");
  }
  return activeUntil > now ? concurrency * 2 : 1;
}

export function rankRuntimeOutcomeHasWork(outcome: string): boolean {
  return outcome !== "IDLE" && outcome !== "DISABLED";
}
