import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import type {
  InternalCancelRankJobInput,
  InternalCreateRankRunInput,
  InternalRetryRankJobInput
} from "@seo-platform/contracts";
import { xmlStockRankProviderPolicyVersion } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { RankEstimate } from "../generated/prisma/client.js";
import type { QueueService } from "../queue/queue.service.js";
import {
  rankEstimateContinuationScopeHash,
  verifiedRankEstimate,
  type CredentialSnapshot
} from "../rank-estimates/rank-estimate.service.js";
import type { RankManifestClient } from "../seo-data/rank-manifest.client.js";
import {
  rankRetryRequestHash,
  rankRunRequestHash,
  type StoredRankJob
} from "./rank-job-record.js";
import { RankPreparationService } from "./rank-preparation.service.js";
import {
  assertExecutionProjectionCurrent,
  confirmedPlatformChargeMicro,
  rankEstimatePolicyMatchesProvider,
  RankRunService
} from "./rank-run.service.js";
import { createContinuationEstimate } from "./rank-continuation-estimate.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const projectId = "0190abcd-0000-7000-8000-000000000002";
const actorId = "0190abcd-0000-7000-8000-000000000003";
const teamActorId = "0190abcd-0000-7000-8000-000000000004";
const estimateId = "0190abcd-0000-7000-8000-000000000005";
const trackingContextId = "0190abcd-0000-7000-8000-000000000006";
const membershipId = "0190abcd-0000-7000-8000-000000000007";
const jobId = "0190abcd-0000-7000-8000-000000000008";

test("uses the immutable policy generation of the selected rank provider", () => {
  assert.equal(
    rankEstimatePolicyMatchesProvider(
      "XMLSTOCK",
      xmlStockRankProviderPolicyVersion
    ),
    true
  );
  assert.equal(
    rankEstimatePolicyMatchesProvider(
      "ARSENKIN",
      xmlStockRankProviderPolicyVersion
    ),
    false
  );
  assert.equal(
    rankEstimatePolicyMatchesProvider("UNSUPPORTED", "rank-estimate:v1"),
    false
  );
});

test("prices a platform Arsenkin batch per keyword, not per provider task", () => {
  const estimate = {
    provider: "ARSENKIN",
    credentialMode: "PLATFORM_PAID",
    keywordCount: 3,
    providerTaskCount: 1
  } as RankEstimate;
  const input = rankRunInput({ confirmedPlatformChargeMicro: "750000" });

  assert.equal(confirmedPlatformChargeMicro(estimate, input), 750_000n);
  assert.throws(
    () =>
      confirmedPlatformChargeMicro(estimate, {
        ...input,
        confirmedPlatformChargeMicro: "250000"
      }),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 409
  );
});

test("projects bounded XMLStock runtime diagnostics without exposing a lease owner", async () => {
  const now = new Date("2026-08-26T18:30:00.000Z");
  let rawQueryCall = 0;
  const prisma = {
    job: {
      findFirst: async () =>
        rankJob({
          provider: "XMLSTOCK",
          scopeSnapshot: {
            searchEngine: "YANDEX",
            searchSource: "LIVE",
            depth: 100,
            providerUsage: {
              provider: "XMLSTOCK",
              product: "YANDEX_TURBO",
              tariffCode: "BASIC",
              currency: "RUB",
              pricePerThousand: "35",
              unitPriceMicro: "35000",
              estimatedRequestCount: { minimum: "4", maximum: "4" },
              estimatedCostMicro: { minimum: "140000", maximum: "140000" },
              pricedAt: "2026-08-26T18:29:00.000Z",
              priceSource: "XMLSTOCK_ACCOUNT_API_WITH_PUBLIC_TURBO_SURCHARGE"
            }
          }
        })
    },
    $queryRaw: async () => {
      rawQueryCall += 1;
      if (rawQueryCall === 1) return [{ now }];
      if (rawQueryCall === 2) {
        return [
          { status: "FETCHING", count: 1n, activeCount: 1n },
          { status: "PERSISTED", count: 1n, activeCount: 0n }
        ];
      }
      if (rawQueryCall === 3) {
        return [
          {
            sequence: 0,
            keyword: "купить холодильник",
            status: "FETCHING",
            executionAttempt: 1,
            submitAttempts: 1,
            pollAttempts: 2,
            nextActionAt: null,
            providerProgress: {
              schemaVersion: "xmlstock-rank-page-progress@2",
              nextPage: 2,
              resultsPerPage: 10
            },
            errorCode: null,
            active: true,
            updatedAt: new Date(now.getTime() - 1_000)
          }
        ];
      }
      throw new Error("Unexpected rank diagnostics query");
    }
  } as unknown as PrismaService;

  const diagnostics = await new RankRunService(prisma, queue([]))
    .runtimeDiagnostics({ workspaceId, projectId, actorId, jobId });

  assert.deepEqual(diagnostics, {
    jobId,
    generatedAt: now.toISOString(),
    policy: {
      product: "YANDEX_TURBO",
      concurrency: 20,
      requestsPerSecond: 15
    },
    totals: {
      total: 3,
      prepared: 2,
      active: 1,
      waitingProvider: 0,
      completed: 1,
      failed: 0
    },
    entries: [
      {
        sequence: 0,
        keyword: "купить холодильник",
        lane: 1,
        state: "REQUESTING",
        executionAttempt: 1,
        submitAttempts: 1,
        pollAttempts: 2,
        completedPages: 2,
        totalPages: 2,
        active: true,
        updatedAt: new Date(now.getTime() - 1_000).toISOString()
      }
    ]
  });
  assert.doesNotMatch(
    JSON.stringify(diagnostics),
    /connector-rank-private-worker-identity/u
  );
});

test("does not expose runtime diagnostics for a non-XMLStock rank run", async () => {
  let rawQueryCalls = 0;
  const prisma = {
    job: { findFirst: async () => rankJob() },
    $queryRaw: async () => {
      rawQueryCalls += 1;
      return [];
    }
  } as unknown as PrismaService;

  await assert.rejects(
    new RankRunService(prisma, queue([])).runtimeDiagnostics({
      workspaceId,
      projectId,
      actorId,
      jobId
    }),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 404
  );
  assert.equal(rawQueryCalls, 0);
});

test("returns the paged per-key XMLStock result scope with the latest poll count", async () => {
  const prisma = {
    job: {
      findFirst: async () => ({
        scopeSnapshot: {},
        items: [
          { sequence: 0, status: "COMPLETED", error: null },
          {
            sequence: 1,
            status: "FAILED_FINAL",
            error: { code: "PROVIDER_TEMPORARY_FAILURE" }
          }
        ]
      })
    },
    rankConnectorExecution: {
      aggregate: async () => ({
        _sum: { submitAttemptCount: 2, pollAttemptCount: 55 }
      }),
      findMany: async () => [
        {
          manifestChunkIndex: 0,
          pollAttemptCount: 5,
          lastErrorCode: null
        },
        {
          manifestChunkIndex: 1,
          pollAttemptCount: 50,
          lastErrorCode: "PROVIDER_UNAVAILABLE"
        },
        {
          manifestChunkIndex: 1,
          pollAttemptCount: 7,
          lastErrorCode: null
        }
      ]
    }
  } as unknown as PrismaService;

  const scope = await new RankRunService(prisma, queue([])).resultScope(
    workspaceId,
    projectId,
    jobId,
    200
  );

  assert.deepEqual(scope, {
    workspaceId,
    projectId,
    jobId,
    items: [
      { sequence: 0, status: "COMPLETED", pollAttempts: 5 },
      {
        sequence: 1,
        status: "FAILED_FINAL",
        pollAttempts: 50,
        errorCode: "PROVIDER_UNAVAILABLE"
      }
    ],
    page: { hasNext: false }
  });
});

test("permits a newer successful validation for the unchanged credential material during execution", () => {
  const estimatedAt = new Date("2026-08-05T10:00:00.000Z");
  const refreshedAt = new Date("2026-08-05T11:00:00.000Z");
  const estimate = executionEstimate(estimatedAt);
  const refreshed = executionCredential({
    credentialVersion: 8,
    validationId: "0190abcd-0000-7000-8000-000000000012",
    validationFinishedAt: refreshedAt,
    verifiedAt: refreshedAt
  });

  assert.throws(
    () =>
      assertExecutionProjectionCurrent(
        estimate,
        refreshed,
        new Date("2026-08-05T11:05:00.000Z")
      ),
    HttpException
  );
  assert.doesNotThrow(() =>
    assertExecutionProjectionCurrent(
      estimate,
      refreshed,
      new Date("2026-08-05T11:05:00.000Z"),
      { allowNewerValidation: true }
    )
  );
});

test("rejects an older validation or changed credential material during execution", () => {
  const estimatedAt = new Date("2026-08-05T10:00:00.000Z");
  const estimate = executionEstimate(estimatedAt);
  const options = { allowNewerValidation: true } as const;

  assert.throws(
    () =>
      assertExecutionProjectionCurrent(
        estimate,
        executionCredential({
          credentialVersion: 8,
          validationId: "0190abcd-0000-7000-8000-000000000012",
          validationFinishedAt: new Date("2026-08-05T09:59:00.000Z"),
          verifiedAt: new Date("2026-08-05T09:59:00.000Z")
        }),
        new Date("2026-08-05T11:05:00.000Z"),
        options
      ),
    HttpException
  );
  assert.throws(
    () =>
      assertExecutionProjectionCurrent(
        estimate,
        executionCredential({
          credentialVersion: 8,
          credentialMaterialVersion: 4,
          validationId: "0190abcd-0000-7000-8000-000000000012",
          validationFinishedAt: new Date("2026-08-05T11:00:00.000Z"),
          verifiedAt: new Date("2026-08-05T11:00:00.000Z")
        }),
        new Date("2026-08-05T11:05:00.000Z"),
        options
      ),
    HttpException
  );
});

function executionEstimate(verifiedAt: Date): RankEstimate {
  return {
    bindingId: "0190abcd-0000-7000-8000-000000000009",
    bindingVersion: 3,
    routeId: "0190abcd-0000-7000-8000-000000000010",
    credentialId: "0190abcd-0000-7000-8000-000000000011",
    credentialStatus: "ACTIVE",
    credentialVersion: 7,
    credentialMaterialVersion: 3,
    credentialDeletedAt: null,
    credentialValidationId: "0190abcd-0000-7000-8000-000000000013",
    credentialValidationVersion: 2,
    credentialValidationConnectorVersion: "xmlstock-rank:v1",
    credentialValidationFinishedAt: verifiedAt,
    credentialVerifiedAt: verifiedAt
  } as RankEstimate;
}

function executionCredential(
  overrides: Partial<CredentialSnapshot> = {}
): CredentialSnapshot {
  const verifiedAt = new Date("2026-08-05T10:00:00.000Z");
  return {
    bindingId: "0190abcd-0000-7000-8000-000000000009",
    bindingVersion: 3,
    routeId: "0190abcd-0000-7000-8000-000000000010",
    credentialId: "0190abcd-0000-7000-8000-000000000011",
    credentialStatus: "ACTIVE",
    credentialVersion: 7,
    credentialMaterialVersion: 3,
    validationId: "0190abcd-0000-7000-8000-000000000013",
    validationVersion: 2,
    validationConnectorVersion: "xmlstock-rank:v1",
    validationFinishedAt: verifiedAt,
    verifiedAt,
    ...overrides
  };
}

test("returns an exact idempotent replay before mutable execution checks", async () => {
  const input = rankRunInput({
    project: {
      id: projectId,
      workspaceId,
      domain: "changed.example",
      status: "ARCHIVED",
      version: 99
    },
    access: {
      workspaceStatus: "READ_ONLY",
      membershipId,
      membershipVersion: 99,
      canRunRanking: false,
      entitlementStatus: "DENIED",
      quota: {
        status: "EXHAUSTED",
        limit: "10",
        used: "10",
        remaining: "0"
      }
    }
  });
  const existing = rankJob({
    requestHash: Uint8Array.from(rankRunRequestHash(input))
  });
  let transactionCalls = 0;
  let estimateLookups = 0;
  const enqueued: string[] = [];
  const prisma = {
    job: {
      findUnique: async () => existing
    },
    rankEstimate: {
      findFirst: async () => {
        estimateLookups += 1;
        throw new Error("replay must not inspect mutable estimate state");
      }
    },
    $transaction: async () => {
      transactionCalls += 1;
      throw new Error("replay must not open the create transaction");
    }
  } as unknown as PrismaService;
  const service = new RankRunService(
    prisma,
    queue(enqueued)
  );

  const replay = await service.create(
    input,
    "rank-run-idempotency-0001",
    "request-replay"
  );

  assert.equal(replay.id, jobId);
  assert.equal(replay.status, "PREPARING");
  assert.equal(transactionCalls, 0);
  assert.equal(estimateLookups, 0);
  assert.deepEqual(enqueued, [jobId]);
});

test("returns an exact missing-position continuation replay without reopening the parent", async () => {
  const input = rankRetryInput();
  const childId = "0190abcd-0000-7000-8000-000000000014";
  const existing = rankJob({
    id: childId,
    parentJobId: jobId,
    idempotencyScope: `rank-run-retry:${jobId}`,
    idempotencyKey: "rank-retry-idempotency-0001",
    requestHash: Uint8Array.from(rankRetryRequestHash(input))
  });
  let transactionCalls = 0;
  const enqueued: string[] = [];
  const prisma = {
    job: { findUnique: async () => existing },
    $transaction: async () => {
      transactionCalls += 1;
      throw new Error("replay must not reopen the parent run");
    }
  } as unknown as PrismaService;
  const service = new RankRunService(prisma, queue(enqueued));

  const replay = await service.retryMissing(
    input,
    "rank-retry-idempotency-0001",
    "request-rank-retry"
  );

  assert.equal(replay.id, childId);
  assert.equal(replay.status, "PREPARING");
  assert.equal(transactionCalls, 0);
  assert.deepEqual(enqueued, [childId]);
});

test("clones a fresh immutable estimate for a missing-position continuation", async () => {
  const continuationEstimateId =
    "0190abcd-0000-7000-8000-000000000014";
  const calculatedAt = new Date("2026-08-06T12:00:00.000Z");
  const parent = {
    id: estimateId,
    workspaceId,
    projectId,
    actorId,
    trackingContextId,
    idempotencyScope: `rank-estimate:${projectId}`,
    idempotencyKey: "parent-estimate-idempotency",
    requestHash: Uint8Array.from({ length: 32 }, () => 1),
    projectVersion: 4,
    projectDomainHash: Uint8Array.from({ length: 32 }, () => 2),
    contextVersion: 5,
    configurationVersion: 4,
    configurationHash: Uint8Array.from({ length: 32 }, () => 3),
    semanticScopeHash: Uint8Array.from({ length: 32 }, () => 4),
    scopeHash: Uint8Array.from({ length: 32 }, () => 5),
    bindingId: "0190abcd-0000-7000-8000-000000000009",
    bindingVersion: 2,
    routeId: "0190abcd-0000-7000-8000-000000000010",
    credentialId: "0190abcd-0000-7000-8000-000000000011",
    credentialStatus: "ACTIVE",
    credentialVersion: 3,
    credentialMaterialVersion: 2,
    credentialDeletedAt: null,
    credentialValidationId:
      "0190abcd-0000-7000-8000-000000000012",
    credentialValidationVersion: 2,
    credentialValidationConnectorVersion: "xmlstock-rank:v1",
    credentialValidationFinishedAt: calculatedAt,
    credentialVerifiedAt: calculatedAt,
    provider: "XMLSTOCK",
    credentialMode: "BYOK_API_KEY",
    providerPolicyVersion: xmlStockRankProviderPolicyVersion,
    keywordCount: 651,
    providerTaskCount: 651,
    minimumSubmitRequestCount: 0,
    minimumCheckRequestCount: 0,
    minimumGetRequestCount: 3_255,
    blockers: [],
    responseSnapshot: {},
    executionSnapshot: {},
    executionSnapshotHash: Uint8Array.from({ length: 32 }, () => 6),
    calculatedAt: new Date("2026-08-06T11:00:00.000Z"),
    expiresAt: new Date("2026-08-06T11:05:00.000Z"),
    createdAt: new Date("2026-08-06T11:00:00.000Z")
  } as RankEstimate;
  const parentSummary = {
    id: parent.id,
    workspaceId,
    projectId,
    trackingContextId,
    status: "READY",
    provider: "XMLSTOCK",
    operation: "POSITIONS",
    credentialMode: "BYOK_API_KEY",
    scope: {
      keywordCount: "651",
      contextCount: "1",
      pairCount: "651",
      scopeHash: {
        availability: "AVAILABLE",
        algorithm: "SHA_256",
        value: Buffer.from(parent.scopeHash ?? []).toString("hex")
      },
      contextVersion: 5,
      configurationVersion: 4
    },
    workload: {
      taskCount: "651",
      minimumRequestCount: "3255",
      pollingRequestCount: { status: "NOT_AVAILABLE" },
      requestStages: ["GET"],
      keywordLimitPerTask: "1",
      keywordLimitPerCommand: "15000",
      format: "SIMPLE",
      rawSerp: false,
      fallbackMode: "NONE"
    },
    providerLimits: { status: "NOT_AVAILABLE" },
    expectedDuration: { status: "NOT_AVAILABLE" },
    platformChargeMicro: "0",
    billingCurrency: "RUB",
    quota: {
      status: "AVAILABLE",
      limit: "1000",
      used: "0",
      remaining: "1000"
    },
    blockers: [],
    credentialFreshness: {
      status: "FRESH",
      verifiedAt: parent.credentialVerifiedAt?.toISOString()
    },
    retention: {
      normalizedRankHistory: "LONG_TERM",
      rawSerp: "NOT_COLLECTED"
    },
    executionAllowed: true,
    policyVersion: xmlStockRankProviderPolicyVersion,
    calculatedAt: parent.calculatedAt.toISOString(),
    expiresAt: parent.expiresAt.toISOString()
  } as unknown as Parameters<typeof createContinuationEstimate>[2];
  const execution = {
    searchEngine: "YANDEX",
    countryCode: "RU",
    regionCode: "213",
    language: "ru",
    device: "DESKTOP",
    depth: 50,
    domainMatchRule: { mode: "INCLUDE_WWW" },
    safeSearch: false,
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE",
    providerMappingVersion: "xmlstock-yandex-live@2"
  } as const;
  let createdData: Readonly<Record<string, unknown>> | undefined;
  const transaction = {
    rankEstimate: {
      create: async ({
        data
      }: {
        readonly data: Readonly<Record<string, unknown>>;
      }) => {
        createdData = data;
        return { ...data, createdAt: calculatedAt } as RankEstimate;
      }
    }
  } as unknown as Parameters<typeof createContinuationEstimate>[0];
  const requestHash = Uint8Array.from({ length: 32 }, () => 7);
  const continuationCredential = executionCredential({
    provider: "XMLSTOCK",
    verifiedAt: calculatedAt,
    validationFinishedAt: calculatedAt
  });
  const continuationScopeHash = rankEstimateContinuationScopeHash(
    parent,
    continuationCredential
  );

  const continuation = await createContinuationEstimate(
    transaction,
    parent,
    parentSummary,
    execution,
    {
      id: continuationEstimateId,
      actorId: teamActorId,
      idempotencyScope: `rank-estimate-retry:${jobId}`,
      idempotencyKey: "retry-estimate-idempotency",
      requestHash,
      calculatedAt,
      pairCount: 455,
      credential: continuationCredential,
      scopeHash: continuationScopeHash
    }
  );

  assert.equal(continuation.id, continuationEstimateId);
  assert.notEqual(continuation.id, parent.id);
  assert.equal(continuation.actorId, teamActorId);
  assert.equal(continuation.keywordCount, 455);
  assert.equal(continuation.providerTaskCount, 455);
  assert.equal(continuation.minimumGetRequestCount, 2_275);
  assert.equal(continuation.expiresAt.getTime(), calculatedAt.getTime() + 300_000);
  assert.deepEqual(continuation.requestHash, requestHash);
  assert.deepEqual(continuation.executionSnapshot, execution);
  assert.deepEqual(verifiedRankEstimate(continuation).execution, execution);
  assert.deepEqual(
    createdData?.responseSnapshot,
    {
      ...parentSummary,
      id: continuationEstimateId,
      scope: {
        ...parentSummary.scope,
        keywordCount: "455",
        pairCount: "455",
        scopeHash: {
          availability: "AVAILABLE",
          algorithm: "SHA_256",
          value: Buffer.from(continuationScopeHash).toString("hex")
        }
      },
      workload: {
        ...parentSummary.workload,
        taskCount: "455",
        minimumRequestCount: "2275"
      },
      credentialFreshness: {
        status: "FRESH",
        verifiedAt: calculatedAt.toISOString()
      },
      calculatedAt: calculatedAt.toISOString(),
      expiresAt: continuation.expiresAt.toISOString()
    }
  );
});

test("returns the attachable equivalent Job after a concurrent create", async () => {
  const prisma = {
    job: {
      findUnique: async () => null
    },
    rankJobRun: {
      findFirst: async () => ({ jobId })
    },
    $transaction: async () => {
      throw { code: "P2002" };
    }
  } as unknown as PrismaService;
  const service = new RankRunService(prisma, queue([]));

  await assert.rejects(
    service.create(
      rankRunInput(),
      "rank-run-idempotency-0002",
      "request-concurrent"
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpException);
      assert.equal(error.getStatus(), 409);
      assert.deepEqual(error.getResponse(), {
        error: {
          code: "EQUIVALENT_RUN_ACTIVE",
          message: "This rank estimate was already used",
          details: {
            reason: "EQUIVALENT_RUN_ACTIVE",
            existingJobId: jobId
          }
        }
      });
      return true;
    }
  );
});

test("fails closed instead of exposing a malformed equivalent Job locator", async () => {
  const prisma = {
    job: {
      findUnique: async () => null
    },
    rankJobRun: {
      findFirst: async () => ({ jobId: "not-a-job-id" })
    },
    $transaction: async () => {
      throw { code: "P2002" };
    }
  } as unknown as PrismaService;
  const service = new RankRunService(prisma, queue([]));

  await assert.rejects(
    service.create(
      rankRunInput(),
      "rank-run-idempotency-0003",
      "request-malformed-winner"
    ),
    /Rank Job conflict details are invalid/u
  );
});

test("cancels an unsealed preparation atomically without manifest work", async () => {
  const now = new Date("2026-07-29T12:01:00.000Z");
  let stored = rankJob();
  let rankRunUpdates = 0;
  let jobUpdates = 0;
  const enqueued: string[] = [];
  const transaction = {
    job: {
      findFirst: async () => stored,
      updateMany: async ({
        where,
        data
      }: {
        where: Readonly<Record<string, unknown>>;
        data: Readonly<Record<string, unknown>>;
      }) => {
        assert.equal(where.status, "PREPARING");
        assert.equal(where.version, 1);
        jobUpdates += 1;
        stored = applyJobMutation(stored, data);
        return { count: 1 };
      }
    },
    rankJobRun: {
      updateMany: async ({
        where,
        data
      }: {
        where: Readonly<Record<string, unknown>>;
        data: Readonly<Record<string, unknown>>;
      }) => {
        assert.deepEqual(where, {
          jobId,
          sealState: "PENDING",
          sealAttemptCount: 0,
          cancelRequestedBy: null
        });
        assert.equal(data.sealState, "NOT_SEALED");
        assert.equal(data.cancelRequestedBy, teamActorId);
        rankRunUpdates += 1;
        stored = {
          ...stored,
          rankRun: {
            ...requiredRun(stored),
            sealState: "NOT_SEALED",
            cancelRequestedBy: teamActorId
          }
        };
        return { count: 1 };
      }
    },
    $queryRaw: async () => [{ now }]
  };
  const prisma = {
    job: {
      findFirst: async () => stored
    },
    $transaction: async (
      operation: (value: typeof transaction) => Promise<unknown>
    ) => operation(transaction)
  } as unknown as PrismaService;
  const service = new RankRunService(
    prisma,
    queue(enqueued)
  );
  const command: InternalCancelRankJobInput = {
    workspaceId,
    projectId,
    actorId: teamActorId,
    jobId
  };

  const cancelled = await service.cancel(command);

  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.finishedAt, now.toISOString());
  assert.equal(stored.status, "CANCELLED");
  assert.equal(stored.rankRun?.sealState, "NOT_SEALED");
  assert.equal(stored.rankRun?.cancelRequestedBy, teamActorId);
  assert.equal(stored.cancelRequestedAt?.toISOString(), now.toISOString());
  assert.equal(stored.finishedAt?.toISOString(), now.toISOString());
  assert.equal(stored.version, 2);
  assert.equal(rankRunUpdates, 1);
  assert.equal(jobUpdates, 1);
  assert.deepEqual(enqueued, []);
});

test("does not let a second worker steal an unexpired preparation lease", async () => {
  const now = new Date("2026-07-29T12:01:00.000Z");
  const stored = rankJob({
    leaseOwner: "rank-worker-one",
    leaseExpiresAt: new Date("2026-07-29T12:02:00.000Z")
  });
  let manifestCalls = 0;
  let updateCalls = 0;
  const transaction = {
    job: {
      findFirst: async () => stored,
      updateMany: async () => {
        updateCalls += 1;
        return { count: 1 };
      }
    },
    rankJobRun: {
      updateMany: async () => {
        updateCalls += 1;
        return { count: 1 };
      }
    },
    $queryRaw: async () => [{ now }]
  };
  const prisma = {
    $transaction: async (
      operation: (value: typeof transaction) => Promise<unknown>
    ) => operation(transaction)
  } as unknown as PrismaService;
  const manifests = {
    seal: async () => {
      manifestCalls += 1;
      throw new Error("must not call SEO Data while another lease is active");
    },
    finalize: async () => {
      manifestCalls += 1;
      throw new Error("must not finalize while another lease is active");
    }
  } as unknown as RankManifestClient;
  const config = {
    rankPreparation: {
      enabled: true,
      leaseSeconds: 90,
      dispatchSeconds: 5,
      resultPersistenceDispatchIntervalMs: 1_000,
      concurrency: 2
    }
  } as AppConfig;
  const service = new RankPreparationService(
    prisma,
    manifests,
    config
  );

  const waiting = await service.process(jobId, "rank-worker-two");

  assert.equal(waiting.status, "PREPARING");
  assert.equal(manifestCalls, 0);
  assert.equal(updateCalls, 0);
});

function rankRunInput(
  overrides: Partial<InternalCreateRankRunInput> = {}
): InternalCreateRankRunInput {
  return {
    workspaceId,
    projectId,
    actorId,
    estimateId,
    confirmedPlatformChargeMicro: "0",
    project: {
      id: projectId,
      workspaceId,
      domain: "example.com",
      status: "ACTIVE",
      version: 4
    },
    access: {
      workspaceStatus: "ACTIVE",
      membershipId,
      membershipVersion: 3,
      canRunRanking: true,
      entitlementStatus: "ALLOWED",
      quota: { status: "UNLIMITED" }
    },
    billingCurrency: "RUB",
    jobCapacity: {
      planCode: "TEAM",
      planVersion: 3,
      concurrentJobs: 10
    },
    providerPricesMinor: {
      ARSENKIN: "25",
      XMLSTOCK: "30"
    },
    ...overrides
  };
}

function rankRetryInput(): InternalRetryRankJobInput {
  const input = rankRunInput();
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorId: input.actorId,
    jobId,
    project: input.project,
    access: input.access,
    billingCurrency: input.billingCurrency,
    jobCapacity: input.jobCapacity,
    providerPricesMinor: input.providerPricesMinor
  };
}

function queue(enqueued: string[]): QueueService {
  return {
    enqueueRankPreparation: async (id: string) => {
      enqueued.push(id);
    }
  } as unknown as QueueService;
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
    rankRun: {
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
    },
    ...overrides
  } as unknown as StoredRankJob;
}

function applyJobMutation(
  current: StoredRankJob,
  data: Readonly<Record<string, unknown>>
): StoredRankJob {
  const version =
    typeof data.version === "object" &&
    data.version !== null &&
    "increment" in data.version
      ? current.version +
        Number(
          (data.version as { readonly increment: number }).increment
        )
      : current.version;
  return {
    ...current,
    status:
      (data.status as StoredRankJob["status"] | undefined) ??
      current.status,
    stage: (data.stage as string | null | undefined) ?? current.stage,
    cancelRequestedAt:
      (data.cancelRequestedAt as Date | null | undefined) ??
      current.cancelRequestedAt,
    finishedAt:
      (data.finishedAt as Date | null | undefined) ??
      current.finishedAt,
    leaseOwner:
      data.leaseOwner === undefined
        ? current.leaseOwner
        : (data.leaseOwner as string | null),
    leaseExpiresAt:
      data.leaseExpiresAt === undefined
        ? current.leaseExpiresAt
        : (data.leaseExpiresAt as Date | null),
    retryAt:
      data.retryAt === undefined
        ? current.retryAt
        : (data.retryAt as Date | null),
    version
  };
}

function requiredRun(
  job: StoredRankJob
): NonNullable<StoredRankJob["rankRun"]> {
  if (!job.rankRun) throw new Error("Missing rank run fixture");
  return job.rankRun;
}
