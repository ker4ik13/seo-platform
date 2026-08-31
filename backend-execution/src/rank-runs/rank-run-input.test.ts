import assert from "node:assert/strict";
import test from "node:test";
import { maximumPlatformRankKeywordPriceMinor } from "@seo-platform/contracts";
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
  confirmedPlatformChargeMicro: "0",
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
    quota: { status: "UNLIMITED" }
  },
  billingCurrency: "RUB",
  jobCapacity: {
    planCode: "PRO",
    planVersion: 2,
    concurrentJobs: 10
  },
  providerPricesMinor: {
    ARSENKIN: "25",
    XMLSTOCK: null
  }
} as const;

test("accepts the exact authoritative run command", () => {
  assert.deepEqual(internalCreateRankRunInput(input), input);
  assert.equal(
    rankRunIdempotencyKey("rank-run-command-0001"),
    "rank-run-command-0001"
  );
});

test("keeps the full paid 15k launch inside PostgreSQL BIGINT", () => {
  const maximum = String(maximumPlatformRankKeywordPriceMinor);
  assert.equal(
    internalCreateRankRunInput({
      ...input,
      providerPricesMinor: { ...input.providerPricesMinor, ARSENKIN: maximum }
    }).providerPricesMinor.ARSENKIN,
    maximum
  );
  assert.throws(
    () =>
      internalCreateRankRunInput({
        ...input,
        providerPricesMinor: {
          ...input.providerPricesMinor,
          ARSENKIN: String(maximumPlatformRankKeywordPriceMinor + 1)
        }
      }),
    /Invalid providerPricesMinor\.ARSENKIN/u
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
          status: "AVAILABLE",
          limit: "1000",
          used: "100",
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
  const {
    estimateId,
    confirmedPlatformChargeMicro: _confirmedPlatformChargeMicro,
    ...snapshot
  } = input;
  const command = { ...snapshot, jobId: estimateId };
  assert.deepEqual(internalRetryRankJobInput(command), command);
  assert.throws(
    () => internalRetryRankJobInput({ ...command, keywordIds: [estimateId] }),
    /Invalid/u
  );
});
