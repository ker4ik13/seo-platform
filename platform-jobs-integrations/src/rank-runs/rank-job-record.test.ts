import assert from "node:assert/strict";
import test from "node:test";
import type { InternalCreateRankRunInput } from "@seo-platform/contracts";
import {
  rankJobAuthorizationSnapshot,
  rankJobInputJson,
  rankJobScopeJson,
  rankRunRequestHash,
  toRankJobSummary,
  type StoredRankJob
} from "./rank-job-record.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const projectId = "0190abcd-0000-7000-8000-000000000002";
const actorId = "0190abcd-0000-7000-8000-000000000003";
const estimateId = "0190abcd-0000-7000-8000-000000000004";
const trackingContextId = "0190abcd-0000-7000-8000-000000000005";
const jobId = "0190abcd-0000-7000-8000-000000000006";

test("builds a redacted allowlisted manual rank Job projection", () => {
  const summary = toRankJobSummary(
    rankJob({
      inputSnapshot: {
        schemaVersion: "manual-rank-check@1",
        credentialId: "secret-credential",
        keywordText: "private keyword"
      },
      rankRun: {
        ...rankRun(),
        projectDomain: "private.example",
        manifestCommand: {
          credentialId: "secret-credential",
          keywords: ["private keyword"]
        }
      }
    })
  );

  assert.deepEqual(summary, {
    id: jobId,
    workspaceId,
    projectId,
    trackingContextId,
    type: "MANUAL_RANK_CHECK",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    credentialMode: "BYOK_API_KEY",
    progress: {
      current: "0",
      total: "3",
      unit: "KEYWORD"
    },
    platformChargeMicro: "0",
    billingCurrency: "RUB",
    status: "PREPARING",
    stage: "PREPARING_SCOPE",
    createdAt: "2026-07-29T12:00:00.000Z"
  });
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes("private.example"), false);
  assert.equal(serialized.includes("private keyword"), false);
  assert.equal(serialized.includes("secret-credential"), false);
});

test("rejects private or malformed terminal result fields instead of projecting them", () => {
  assert.throws(
    () =>
      toRankJobSummary(
        rankJob({
          status: "COMPLETED",
          stage: "FINISHED",
          queuedAt: new Date("2026-07-29T12:00:01.000Z"),
          startedAt: new Date("2026-07-29T12:00:02.000Z"),
          finishedAt: new Date("2026-07-29T12:00:03.000Z"),
          progressCurrent: 3n,
          resultSummary: {
            pairCount: "3",
            persistedCount: "3",
            foundCount: "2",
            notFoundCount: "1",
            failedCount: "0",
            submitOutcomeUnknownCount: "0",
            providerRequestId: "must-not-leak"
          }
        })
      ),
    /Invalid stored manual rank Job/
  );
});

test("projects an unresolved submit only as terminal action required", () => {
  const finishedAt = new Date("2026-07-29T12:00:03.000Z");
  const summary = toRankJobSummary(
    rankJob({
      status: "ACTION_REQUIRED",
      stage: "SUBMIT_OUTCOME_UNKNOWN",
      finishedAt,
      errorSummary: { code: "SUBMIT_OUTCOME_UNKNOWN" },
      resultSummary: {
        pairCount: "3",
        persistedCount: "0",
        foundCount: "0",
        notFoundCount: "0",
        failedCount: "0",
        submitOutcomeUnknownCount: "3"
      }
    })
  );

  assert.equal(summary.status, "ACTION_REQUIRED");
  assert.equal(summary.stage, "SUBMIT_OUTCOME_UNKNOWN");
  assert.deepEqual(summary.failure, { code: "SUBMIT_OUTCOME_UNKNOWN" });
  assert.equal(summary.result.submitOutcomeUnknownCount, "3");
  assert.equal(summary.finishedAt, finishedAt.toISOString());
});

test("projects persisted chunks while preserving an unresolved submit", () => {
  const summary = toRankJobSummary(
    rankJob({
      status: "ACTION_REQUIRED",
      stage: "SUBMIT_OUTCOME_UNKNOWN",
      finishedAt: new Date("2026-07-29T12:00:03.000Z"),
      errorSummary: { code: "SUBMIT_OUTCOME_UNKNOWN" },
      resultSummary: {
        pairCount: "3",
        persistedCount: "1",
        foundCount: "1",
        notFoundCount: "0",
        failedCount: "0",
        submitOutcomeUnknownCount: "2"
      },
      progressCurrent: 1n
    })
  );
  assert.equal(summary.status, "ACTION_REQUIRED");
  assert.equal(summary.progress.current, "1");
  assert.equal(summary.result.persistedCount, "1");
  assert.equal(summary.result.submitOutcomeUnknownCount, "2");

  assert.throws(
    () =>
      toRankJobSummary(
        rankJob({
          status: "ACTION_REQUIRED",
          stage: "SUBMIT_OUTCOME_UNKNOWN",
          finishedAt: new Date("2026-07-29T12:00:03.000Z"),
          errorSummary: { code: "SUBMIT_OUTCOME_UNKNOWN" },
          resultSummary: {
            pairCount: "3",
            persistedCount: "1",
            foundCount: "1",
            notFoundCount: "0",
            failedCount: "1",
            submitOutcomeUnknownCount: "2"
          },
          progressCurrent: 1n
        })
      ),
    /Invalid stored manual rank Job/
  );
});

test("keeps idempotency intent independent from mutable access snapshots", () => {
  const original = rankRunInput();
  const changedSnapshots: InternalCreateRankRunInput = {
    ...original,
    project: {
      ...original.project,
      domain: "new.example",
      status: "ARCHIVED",
      version: 99
    },
    access: {
      ...original.access,
      workspaceStatus: "READ_ONLY",
      membershipVersion: 22,
      canRunRanking: false,
      entitlementStatus: "DENIED",
      quota: {
        status: "EXHAUSTED",
        limit: "10",
        used: "10",
        remaining: "0"
      }
    },
    billingCurrency: "USD"
  };
  const anotherActor: InternalCreateRankRunInput = {
    ...original,
    actorId: "0190abcd-0000-7000-8000-000000000007"
  };

  assert.deepEqual(
    rankRunRequestHash(original),
    rankRunRequestHash(changedSnapshots)
  );
  assert.notDeepEqual(
    rankRunRequestHash(original),
    rankRunRequestHash(anotherActor)
  );
});

test("persists only bounded audit and scope snapshots in the generic Job", () => {
  const input = rankRunInput();

  assert.deepEqual(rankJobInputJson(input), {
    schemaVersion: "manual-rank-check@1",
    estimateId,
    membershipId: input.access.membershipId,
    membershipVersion: 3,
    projectVersion: 4
  });
  assert.deepEqual(rankJobScopeJson(input, trackingContextId), {
    schemaVersion: "manual-rank-check@1",
    workspaceId,
    projectId,
    trackingContextId
  });
  assert.deepEqual(
    rankJobAuthorizationSnapshot(rankJobInputJson(input)),
    {
      estimateId,
      membershipId: input.access.membershipId,
      membershipVersion: 3,
      projectVersion: 4
    }
  );
  assert.throws(
    () =>
      rankJobAuthorizationSnapshot({
        schemaVersion: "manual-rank-check@1",
        estimateId,
        membershipId: input.access.membershipId,
        membershipVersion: 3,
        projectVersion: 4,
        credentialId: "must-not-cross"
      }),
    /Invalid stored manual rank Job/u
  );
});

function rankRunInput(): InternalCreateRankRunInput {
  return {
    workspaceId,
    projectId,
    actorId,
    estimateId,
    project: {
      id: projectId,
      workspaceId,
      domain: "example.com",
      status: "ACTIVE",
      version: 4
    },
    access: {
      workspaceStatus: "ACTIVE",
      membershipId: "0190abcd-0000-7000-8000-000000000008",
      membershipVersion: 3,
      canRunRanking: true,
      entitlementStatus: "ALLOWED",
      quota: {
        status: "AVAILABLE",
        limit: "10",
        used: "0",
        remaining: "10"
      }
    },
    billingCurrency: "RUB",
    jobCapacity: {
      planCode: "TEAM",
      planVersion: 3,
      concurrentJobs: 10
    }
  };
}

function rankJob(
  overrides: Readonly<Record<string, unknown>> = {}
): StoredRankJob {
  return {
    id: jobId,
    workspaceId,
    projectId,
    type: "MANUAL_RANK_CHECK",
    status: "PREPARING",
    stage: "PREPARING_SCOPE",
    priority: 100,
    actorId,
    scheduleId: null,
    parentJobId: null,
    deduplicationKey: `manual-rank-estimate:${estimateId}`,
    idempotencyScope: `rank-run:${projectId}`,
    idempotencyKey: "rank-run-idempotency-0001",
    requestHash: new Uint8Array(32),
    inputSnapshot: {},
    scopeSnapshot: {},
    progressCurrent: 0n,
    progressTotal: 3n,
    progressUnit: "KEYWORD",
    estimatedCostMicro: 0n,
    reservedCostMicro: null,
    actualCostMicro: null,
    currency: "RUB",
    credentialMode: "BYOK_API_KEY",
    provider: "ARSENKIN",
    attempt: 0,
    maxAttempts: 20,
    errorSummary: null,
    resultSummary: null,
    correlationId: "request-1",
    version: 1,
    createdAt: new Date("2026-07-29T12:00:00.000Z"),
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    cancelRequestedAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    retryAt: null,
    updatedAt: new Date("2026-07-29T12:00:00.000Z"),
    rankRun: rankRun(),
    ...overrides
  } as unknown as StoredRankJob;
}

function rankRun(): NonNullable<StoredRankJob["rankRun"]> {
  return {
    jobId,
    workspaceId,
    projectId,
    estimateId,
    trackingContextId,
    projectDomain: "example.com",
    projectStatus: "ACTIVE",
    projectVersion: 4,
    manifestCommand: {},
    manifestCommandHash: new Uint8Array(32),
    sealState: "PENDING",
    sealAttemptCount: 0,
    lastSealAttemptAt: null,
    manifestId: null,
    manifestHashSchema: null,
    manifestHash: null,
    manifestDeduplicationHash: null,
    manifestPairCount: null,
    manifestChunkCount: null,
    manifestChunkSize: null,
    manifestSealedAt: null,
    finalizationStatus: null,
    finalizationRequestHash: null,
    finalizedAt: null,
    cancelRequestedBy: null,
    createdAt: new Date("2026-07-29T12:00:00.000Z"),
    updatedAt: new Date("2026-07-29T12:00:00.000Z")
  };
}
