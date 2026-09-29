import assert from "node:assert/strict";
import test from "node:test";
import { RankClaimCapacity } from "./rank-claim-capacity.js";

test("bounds simultaneous claims while allowing completed claims to fan out", async () => {
  const gate = new RankClaimCapacity(3);
  let active = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  const operations = Array.from({ length: 12 }, (_, index) => gate.run(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active -= 1;
    return index;
  }));

  await Promise.resolve();
  assert.equal(active, 3);
  for (let index = 0; index < 12; index += 1) {
    const release = releases.shift();
    assert.ok(release);
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(active <= 3);
  }
  assert.deepEqual(await Promise.all(operations), Array.from({ length: 12 }, (_, index) => index));
  assert.equal(peak, 3);
  assert.equal(active, 0);
});

test("releases claim capacity after a failed database operation", async () => {
  const gate = new RankClaimCapacity(1);
  await assert.rejects(gate.run(async () => { throw new Error("claim failed"); }), /claim failed/u);
  assert.equal(await gate.run(async () => "next claim"), "next claim");
  assert.throws(() => new RankClaimCapacity(0), TypeError);
});
