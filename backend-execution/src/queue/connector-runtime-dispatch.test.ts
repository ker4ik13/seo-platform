import assert from "node:assert/strict";
import test from "node:test";
import {
  AdaptiveRankLaneDemand,
  adaptiveRankDispatchBurst,
  connectorRuntimeLaneCount,
  rankRuntimeOutcomeHasWork,
  rankRuntimeJobUsesCurrentLane,
  shardedDispatchLane,
  shardedDispatchSequence
} from "./connector-runtime-dispatch.js";

test("connector processes publish non-overlapping runtime jobs", () => {
  const values = new Set<number>();
  for (let shard = 0; shard < 2; shard += 1) {
    for (let slot = 0; slot < 32; slot += 1) {
      values.add(shardedDispatchSequence(42, 32, shard, 2, slot));
    }
  }
  assert.equal(values.size, 64);
  assert.deepEqual(
    [...values].sort((left, right) => left - right),
    Array.from({ length: 64 }, (_, index) => 42 * 64 + index)
  );
});

test("keyword research gets one independent lane per connector process", () => {
  assert.deepEqual(
    Array.from({ length: 2 }, (_, shard) => shardedDispatchLane(1, shard, 2, 0)),
    [0, 1]
  );
  assert.deepEqual(
    Array.from({ length: 2 }, (_, shard) => shardedDispatchSequence(12, 1, shard, 2, 0)),
    [24, 25]
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
  for (let shard = 0; shard < 2; shard += 1) {
    for (let slot = 0; slot < 32; slot += 1) {
      lanes.add(shardedDispatchLane(32, shard, 2, slot));
    }
  }
  assert.equal(connectorRuntimeLaneCount(32, 2), 64);
  assert.deepEqual(
    [...lanes].sort((left, right) => left - right),
    Array.from({ length: 64 }, (_, index) => index)
  );
  assert.equal(
    rankRuntimeJobUsesCurrentLane("rank-connector-runtime-63", 64),
    true
  );
  assert.equal(
    rankRuntimeJobUsesCurrentLane("rank-connector-runtime-64", 64),
    false
  );
  assert.equal(
    rankRuntimeJobUsesCurrentLane("rank-connector-runtime-84500000000", 64),
    false
  );
  assert.throws(
    () => shardedDispatchLane(32, 3, 3, 0),
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

test("rank demand grows to the full pool but shrinks near one saturated key", () => {
  const demand = new AdaptiveRankLaneDemand(32);
  let burst = demand.nextBurst();
  assert.equal(burst, 1);

  for (let round = 0; round < 9; round += 1) {
    for (let slot = 0; slot < burst; slot += 1) {
      demand.started();
      demand.finished("POLL_CHECKPOINTED");
    }
    burst = demand.nextBurst();
  }
  assert.equal(burst, 32);

  for (let slot = 0; slot < burst; slot += 1) {
    demand.started();
    demand.finished(slot < 10 ? "POLL_CHECKPOINTED" : "PROVIDER_CAPACITY_DELAYED");
  }
  assert.equal(demand.nextBurst(), 12);

  for (let slot = 0; slot < 12; slot += 1) {
    demand.started();
    demand.finished("IDLE");
  }
  assert.equal(demand.nextBurst(), 1);
  assert.throws(() => demand.finished("IDLE"), TypeError);
});

test("rank demand opens more probes while provider HTTP calls are pending", () => {
  const demand = new AdaptiveRankLaneDemand(32);
  demand.started();
  assert.equal(demand.nextBurst(), 2);
  demand.started();
  assert.equal(demand.nextBurst(), 3);
  demand.finished("POLL_PENDING");
  demand.finished("POLL_PENDING");
  assert.equal(demand.nextBurst(), 5);
});
