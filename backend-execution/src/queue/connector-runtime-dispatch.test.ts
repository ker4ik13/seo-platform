import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptiveRankDispatchBurst,
  connectorRuntimeLaneCount,
  rankRuntimeOutcomeHasWork,
  rankRuntimeJobUsesCurrentLane,
  shardedDispatchLane,
  shardedDispatchSequence
} from "./connector-runtime-dispatch.js";

test("connector processes publish non-overlapping runtime jobs", () => {
  const values = new Set<number>();
  for (let shard = 0; shard < 3; shard += 1) {
    for (let slot = 0; slot < 32; slot += 1) {
      values.add(shardedDispatchSequence(42, 32, shard, 3, slot));
    }
  }
  assert.equal(values.size, 96);
  assert.deepEqual(
    [...values].sort((left, right) => left - right),
    Array.from({ length: 96 }, (_, index) => 42 * 96 + index)
  );
});

test("connector dispatch sequence rejects malformed shard coordinates", () => {
  assert.throws(
    () => shardedDispatchSequence(1, 4, 3, 3, 0),
    /Invalid connector runtime dispatch shard/u
  );
  assert.throws(
    () => shardedDispatchSequence(1, 4, 0, 3, 4),
    /Invalid connector runtime dispatch shard/u
  );
});

test("connector slots map to a fixed bounded lane set", () => {
  const lanes = new Set<number>();
  for (let shard = 0; shard < 3; shard += 1) {
    for (let slot = 0; slot < 16; slot += 1) {
      lanes.add(shardedDispatchLane(16, shard, 3, slot));
    }
  }
  assert.equal(connectorRuntimeLaneCount(16, 3), 48);
  assert.deepEqual(
    [...lanes].sort((left, right) => left - right),
    Array.from({ length: 48 }, (_, index) => index)
  );
  assert.equal(
    rankRuntimeJobUsesCurrentLane("rank-connector-runtime-47", 48),
    true
  );
  assert.equal(
    rankRuntimeJobUsesCurrentLane("rank-connector-runtime-48", 48),
    false
  );
  assert.equal(
    rankRuntimeJobUsesCurrentLane("rank-connector-runtime-84500000000", 48),
    false
  );
  assert.throws(
    () => shardedDispatchLane(16, 3, 3, 0),
    /Invalid connector runtime lane/u
  );
});

test("rank dispatch keeps one idle probe and restores the full pool on activity", () => {
  assert.equal(adaptiveRankDispatchBurst(16, 9_999, 10_000), 1);
  assert.equal(adaptiveRankDispatchBurst(16, 10_001, 10_000), 16);
  assert.equal(rankRuntimeOutcomeHasWork("IDLE"), false);
  assert.equal(rankRuntimeOutcomeHasWork("DISABLED"), false);
  assert.equal(rankRuntimeOutcomeHasWork("LEASE_LOST"), false);
  assert.equal(rankRuntimeOutcomeHasWork("PROVIDER_CAPACITY_DELAYED"), false);
  assert.equal(rankRuntimeOutcomeHasWork("STALE_DISPATCH_TICK"), false);
  assert.equal(rankRuntimeOutcomeHasWork("SUBMITTED"), true);
  assert.equal(rankRuntimeOutcomeHasWork("POLL_PENDING"), true);
});
