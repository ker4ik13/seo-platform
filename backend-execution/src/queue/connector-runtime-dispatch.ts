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
 * Returns one stable queue lane for a worker slot. Unlike a time-based tick
 * identifier, a lane cannot accumulate while Redis or a consumer is degraded:
 * at most one waiting/active job exists for every configured slot.
 */
export function shardedDispatchLane(
  localConcurrency: number,
  shardIndex: number,
  shardCount: number,
  slot: number
): number {
  if (
    ![localConcurrency, shardIndex, shardCount, slot].every(
      Number.isSafeInteger
    ) ||
    localConcurrency < 1 ||
    shardCount < 1 ||
    shardIndex < 0 ||
    shardIndex >= shardCount ||
    slot < 0 ||
    slot >= localConcurrency
  ) {
    throw new TypeError("Invalid connector runtime lane");
  }
  const lane = shardIndex * localConcurrency + slot;
  if (!Number.isSafeInteger(lane)) {
    throw new TypeError("Connector runtime lane overflow");
  }
  return lane;
}

export function connectorRuntimeLaneCount(
  localConcurrency: number,
  shardCount: number
): number {
  if (
    !Number.isSafeInteger(localConcurrency) ||
    localConcurrency < 1 ||
    !Number.isSafeInteger(shardCount) ||
    shardCount < 1
  ) {
    throw new TypeError("Invalid connector runtime lane count");
  }
  const count = localConcurrency * shardCount;
  if (!Number.isSafeInteger(count)) {
    throw new TypeError("Connector runtime lane count overflow");
  }
  return count;
}

export function rankRuntimeJobUsesCurrentLane(
  jobId: string | undefined,
  laneCount: number
): boolean {
  if (!Number.isSafeInteger(laneCount) || laneCount < 1) {
    throw new TypeError("Invalid rank runtime lane count");
  }
  const match = /^rank-connector-runtime-(\d+)$/u.exec(jobId ?? "");
  if (!match) return false;
  const lane = Number(match[1]);
  return Number.isSafeInteger(lane) && lane >= 0 && lane < laneCount;
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
  return activeUntil > now ? concurrency : 1;
}

export function rankRuntimeOutcomeHasWork(outcome: string): boolean {
  return [
    "SUBMITTED",
    "SUBMIT_TERMINAL",
    "POLL_PENDING",
    "POLL_CHECKPOINTED",
    "RESULT_STAGED",
    "POLL_TERMINAL"
  ].includes(outcome);
}
