import assert from "node:assert/strict";
import test from "node:test";
import {
  internalCancelRankJobInput,
  internalCreateRankRunInput,
  internalRetryRankJobInput,
  rankRunIdempotencyKey
} from "./rank-run-input.js";

const input = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  estimateId: "01900000-0000-7000-8000-000000000004",
  project: {
    id: "01900000-0000-7000-8000-000000000002",
    workspaceId: "01900000-0000-7000-8000-000000000001",
    domain: "example.com",
    status: "ACTIVE",
    version: 4
  },
  access: {
    workspaceStatus: "ACTIVE",
    membershipId: "01900000-0000-7000-8000-000000000005",
    membershipVersion: 3,
    canRunRanking: true,
    entitlementStatus: "ALLOWED",
    quota: {
      status: "AVAILABLE",
      limit: "1000",
      used: "100",
      remaining: "900"
    }
  },
  billingCurrency: "RUB",
  jobCapacity: {
    planCode: "PRO",
    planVersion: 2,
    concurrentJobs: 10
  }
} as const;

test("accepts the exact authoritative run command", () => {
  assert.deepEqual(internalCreateRankRunInput(input), input);
  assert.equal(
    rankRunIdempotencyKey("rank-run-command-0001"),
    "rank-run-command-0001"
  );
});

test("rejects forged scope, unknown fields and inconsistent quota", () => {
  for (const candidate of [
    { ...input, workspaceId: input.actorId },
    { ...input, secret: "must-not-pass" },
    {
      ...input,
      access: {
        ...input.access,
        quota: {
          ...input.access.quota,
          remaining: "901"
        }
      }
    }
  ]) {
    assert.throws(() => internalCreateRankRunInput(candidate), /Invalid/u);
  }
  assert.throws(() => rankRunIdempotencyKey("short"), /Invalid/u);
});

test("parses teammate cancellation as tenant scope, not ownership", () => {
  const command = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorId: input.actorId,
    jobId: input.estimateId
  };
  assert.deepEqual(internalCancelRankJobInput(command), command);
  assert.throws(
    () => internalCancelRankJobInput({ ...command, ownerId: input.actorId }),
    /Invalid/u
  );
});

test("parses a continuation command without accepting browser keyword scope", () => {
  const { estimateId, ...snapshot } = input;
  const command = { ...snapshot, jobId: estimateId };
  assert.deepEqual(internalRetryRankJobInput(command), command);
  assert.throws(
    () => internalRetryRankJobInput({ ...command, keywordIds: [estimateId] }),
    /Invalid/u
  );
});
