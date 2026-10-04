import assert from "node:assert/strict";
import test from "node:test";
import { parseRemoteRankClaim, parseRemoteRankPollResultBatch } from "./worker-rank.js";

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

test("rank result batch accepts at most eight exact independent receipts", () => {
  const entry = { schemaVersion: "worker-rank-poll-result@1", ticket: "signed-ticket", requestSnapshot: {}, outcome: {} };
  const batch = { schemaVersion: "worker-rank-poll-result-batch@1", entries: [entry] };
  assert.deepEqual(parseRemoteRankPollResultBatch(batch), batch);
  for (const input of [
    { ...batch, entries: [] },
    { ...batch, entries: Array.from({ length: 9 }, () => entry) },
    { ...batch, entries: [{ ...entry, secret: "no" }] },
    { ...batch, entries: [{ ...entry, ticket: "" }] },
    { ...batch, nodeToken: "no" }
  ]) assert.throws(() => parseRemoteRankPollResultBatch(input), TypeError);
});
