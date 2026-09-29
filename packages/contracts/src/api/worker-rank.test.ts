import assert from "node:assert/strict";
import test from "node:test";
import { parseRemoteRankClaim } from "./worker-rank.js";

test("remote rank claim permits one bounded batch request", () => {
  assert.deepEqual(parseRemoteRankClaim({ availableSlots: 32 }), { availableSlots: 32 });
  for (const input of [
    {}, { availableSlots: 0 }, { availableSlots: 513 },
    { availableSlots: 1.5 }, { availableSlots: "16" },
    { availableSlots: 1, token: "not-allowed" }
  ]) {
    assert.throws(() => parseRemoteRankClaim(input), TypeError);
  }
});
