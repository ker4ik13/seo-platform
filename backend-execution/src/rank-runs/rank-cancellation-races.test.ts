import assert from "node:assert/strict";
import test from "node:test";
import type {
  InternalCancelRankJobInput,
  InternalFinalizeRankCheckInput,
  InternalRankManifestSeal,
  InternalSealRankManifestInput
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { RankJobRun } from "../generated/prisma/client.js";
import type { QueueService } from "../queue/queue.service.js";
import type { RankManifestClient } from "../seo-data/rank-manifest.client.js";
import type { StoredRankJob } from "./rank-job-record.js";
import { rankManifestCommandHash } from "./rank-manifest-command.js";
import { RankPreparationService } from "./rank-preparation.service.js";
import { RankRunService } from "./rank-run.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const cancellingActorId = "01900000-0000-7000-8000-000000000004";
const jobId = "01900000-0000-7000-8000-000000000005";
const estimateId = "01900000-0000-7000-8000-000000000006";
const trackingContextId = "01900000-0000-7000-8000-000000000007";
const manifestId = "01900000-0000-7000-8000-000000000008";
const leaseOwner = "rank-worker-cancel-race";
const claimAt = new Date("2026-07-29T12:00:30.000Z");
const cancelAt = new Date("2026-07-29T12:00:40.000Z");
const sealedAt = "2026-07-29T12:00:45.000Z";
const finalizedAt = "2026-07-29T12:00:50.000Z";

test("accepts the single cancellation drift after seal, persists no chunks, and finalizes with the cancelling actor", async () => {
  let stored = rankJob();
  let itemCreates = 0;
  let sealCalls = 0;
  let finalizeCalls = 0;
  let finalizeInput: InternalFinalizeRankCheckInput | undefined;
  const transitions: string[] = [];

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
        if (
          (where.id !== undefined && where.id !== stored.id) ||
          (where.status !== undefined && where.status !== stored.status) ||
          (where.version !== undefined && where.version !== stored.version) ||
          (where.leaseOwner !== undefined &&
            where.leaseOwner !== stored.leaseOwner)
        ) {
          return { count: 0 };
        }
        stored = applyJobMutation(stored, data);
        return { count: 1 };
      }
    },
    jobItem: {
      createMany: async () => {
        itemCreates += 1;
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
        const run = requiredRun(stored);
        if (
          where.jobId !== stored.id ||
          (where.sealState !== undefined &&
            where.sealState !== run.sealState) ||
          (where.sealAttemptCount !== undefined &&
            where.sealAttemptCount !== run.sealAttemptCount) ||
          (where.manifestId !== undefined &&
            where.manifestId !== run.manifestId)
        ) {
          return { count: 0 };
        }
        stored = {
          ...stored,
          rankRun: applyRunMutation(run, data)
        };
        if (typeof data.sealState === "string") {
          transitions.push(data.sealState);
        }
        return { count: 1 };
      }
    },
    $queryRaw: queryRaw(claimAt)
  };
  const prisma = {
    job: transaction.job,
    $transaction: async (
      operation: (value: typeof transaction) => Promise<unknown>
    ) => operation(transaction)
  } as unknown as PrismaService;
  const manifests = {
    seal: async (
      input: InternalSealRankManifestInput
    ): Promise<InternalRankManifestSeal> => {
      sealCalls += 1;
      assert.equal(stored.status, "PREPARING");
      assert.equal(stored.version, 2);
      assert.equal(stored.attempt, 1);
      assert.equal(stored.leaseOwner, leaseOwner);
      assert.equal(input.jobId, jobId);

      stored = {
        ...stored,
        status: "CANCEL_REQUESTED",
        cancelRequestedAt: cancelAt,
        version: stored.version + 1,
        rankRun: {
          ...requiredRun(stored),
          cancelRequestedBy: cancellingActorId
        }
      };
      return manifestSeal();
    },
    finalize: async (
      input: InternalFinalizeRankCheckInput
    ): Promise<finalizationReceipt> => {
      finalizeCalls += 1;
      finalizeInput = input;
      return finalizationReceiptValue();
    }
  } as unknown as RankManifestClient;
  const service = new RankPreparationService(
    prisma,
    manifests,
    rankPreparationConfig()
  );

  const summary = await service.process(jobId, leaseOwner);

  assert.equal(sealCalls, 1);
  assert.equal(finalizeCalls, 1);
  assert.equal(itemCreates, 0);
  assert.deepEqual(transitions, [
    "OUTCOME_UNKNOWN",
    "SEALED",
    "FINALIZED"
  ]);
  assert.deepEqual(finalizeInput, {
    schemaVersion: "rank-finalize@1",
    workspaceId,
    projectId,
    actorId: cancellingActorId,
    jobId,
    manifestId,
    status: "CANCELLED"
  });
  assert.equal(stored.status, "CANCELLED");
  assert.equal(stored.stage, "FINISHED");
  assert.equal(stored.version, 5);
  assert.equal(stored.attempt, 1);
  assert.equal(stored.leaseOwner, null);
  assert.equal(stored.leaseExpiresAt, null);
  assert.equal(stored.rankRun?.sealState, "FINALIZED");
  assert.equal(stored.rankRun?.manifestId, manifestId);
  assert.equal(stored.rankRun?.cancelRequestedBy, cancellingActorId);
  assert.equal(stored.rankRun?.finalizationStatus, "CANCELLED");
  assert.equal(stored.finishedAt?.toISOString(), finalizedAt);
  assert.equal(summary.status, "CANCELLED");
  assert.equal(summary.finishedAt, finalizedAt);
  assert.deepEqual(summary.progress, {
    current: "0",
    total: "3",
    unit: "KEYWORD"
  });
});

for (const [label, concurrencyError] of [
  [
    "Prisma P2034",
    Object.assign(new Error("write conflict"), { code: "P2034" })
  ],
  [
    "adapter originalCode 40P01",
    Object.assign(new Error("adapter transaction failure"), {
      driverAdapterError: { originalCode: "40P01" }
    })
  ]
] as const) {
  test(`cancel retries ${label} and returns the terminal Job instead of a 500`, async () => {
    let stored = rankJob();
    let transactionCalls = 0;
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
          if (
            where.status !== stored.status ||
            where.version !== stored.version
          ) {
            return { count: 0 };
          }
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
          const run = requiredRun(stored);
          if (
            where.jobId !== stored.id ||
            where.sealState !== run.sealState ||
            where.sealAttemptCount !== run.sealAttemptCount ||
            where.cancelRequestedBy !== run.cancelRequestedBy
          ) {
            return { count: 0 };
          }
          stored = {
            ...stored,
            rankRun: applyRunMutation(run, data)
          };
          return { count: 1 };
        }
      },
      $queryRaw: queryRaw(cancelAt)
    };
    const prisma = {
      job: {
        findFirst: async () => stored
      },
      $transaction: async (
        operation: (value: typeof transaction) => Promise<unknown>
      ) => {
        transactionCalls += 1;
        if (transactionCalls === 1) throw concurrencyError;
        return operation(transaction);
      }
    } as unknown as PrismaService;
    const service = new RankRunService(prisma, silentQueue());

    const summary = await service.cancel(cancelCommand());

    assert.equal(transactionCalls, 2);
    assert.equal(summary.status, "CANCELLED");
    assert.equal(summary.finishedAt, cancelAt.toISOString());
    assert.equal(stored.status, "CANCELLED");
    assert.equal(stored.rankRun?.sealState, "NOT_SEALED");
    assert.equal(stored.rankRun?.cancelRequestedBy, cancellingActorId);
  });
}

type finalizationReceipt = Awaited<
  ReturnType<RankManifestClient["finalize"]>
>;

function rankJob(): StoredRankJob {
  const command = manifestCommand();
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
    idempotencyKey: "rank-run-cancel-race-0001",
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
    correlationId: "request-race",
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
      manifestCommand: command,
      manifestCommandHash: rankManifestCommandHash(command),
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
    }
  } as unknown as StoredRankJob;
}

function manifestCommand(): InternalSealRankManifestInput {
  return {
    workspaceId,
    projectId,
    actorId,
    jobId,
    estimateId,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    project: {
      id: projectId,
      workspaceId,
      domain: "example.com",
      status: "ACTIVE",
      version: 4
    },
    estimate: {
      trackingContextId,
      contextVersion: 3,
      configurationVersion: 2,
      configurationHash: hash("a"),
      semanticScopeHash: hash("b"),
      scopeHash: hash("c"),
      pairCount: "3",
      expiresAt: "2026-07-29T12:05:00.000Z"
    },
    execution: {
      searchEngine: "GOOGLE",
      countryCode: "US",
      language: "en",
      device: "DESKTOP",
      depth: 30,
      domainMatchRule: { mode: "EXACT_HOST" },
      safeSearch: false,
      format: "SIMPLE",
      rawSerp: false,
      fallbackMode: "NONE",
      providerMappingVersion: "arsenkin-positions@1"
    },
    retention: {
      normalizedRankHistory: "LONG_TERM",
      rawSerp: "NOT_COLLECTED"
    }
  };
}

function manifestSeal(): InternalRankManifestSeal {
  const command = manifestCommand();
  return {
    id: manifestId,
    workspaceId,
    projectId,
    jobId,
    estimateId,
    estimateExpiresAt: command.estimate.expiresAt,
    sealedBy: actorId,
    trackingContextId,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    project: command.project,
    contextVersion: command.estimate.contextVersion,
    configurationVersion: command.estimate.configurationVersion,
    configurationHash: command.estimate.configurationHash,
    semanticScopeHash: command.estimate.semanticScopeHash,
    scopeHash: command.estimate.scopeHash,
    hashSchemaVersion: "rank-manifest@1",
    manifestHash: hash("d"),
    deduplicationHash: hash("e"),
    pairCount: "3",
    chunkCount: "1",
    chunkSize: "250",
    execution: command.execution,
    retention: command.retention,
    status: "SEALED",
    sealedAt
  };
}

function finalizationReceiptValue(): finalizationReceipt {
  return {
    schemaVersion: "rank-finalize@1",
    workspaceId,
    projectId,
    jobId,
    manifestId,
    requestHash: hash("f"),
    trackingContextId,
    configurationVersion: 2,
    status: "CANCELLED",
    pairCount: "3",
    persistedCount: "0",
    foundCount: "0",
    notFoundCount: "0",
    missingCount: "3",
    finalizedAt
  };
}

function cancelCommand(): InternalCancelRankJobInput {
  return {
    workspaceId,
    projectId,
    actorId: cancellingActorId,
    jobId
  };
}

function rankPreparationConfig(): AppConfig {
  return {
    rankPreparation: {
      enabled: true,
      leaseSeconds: 90,
      dispatchSeconds: 5,
      concurrency: 2
    }
  } as AppConfig;
}

function silentQueue(): QueueService {
  return {
    enqueueRankPreparation: async () => undefined
  } as unknown as QueueService;
}

function queryRaw(
  now: Date
): (query: TemplateStringsArray) => Promise<readonly object[]> {
  return async (query) => {
    const sql = query.join("");
    if (sql.includes("clock_timestamp")) return [{ now }];
    if (sql.includes('FROM "jobs"')) {
      return [{ jobId, workspaceId, projectId }];
    }
    if (sql.includes('FROM "rank_job_runs"')) return [{ jobId }];
    throw new Error(`Unexpected SQL in rank race harness: ${sql}`);
  };
}

function applyJobMutation(
  current: StoredRankJob,
  data: Readonly<Record<string, unknown>>
): StoredRankJob {
  return {
    ...current,
    status:
      (data.status as StoredRankJob["status"] | undefined) ??
      current.status,
    stage:
      data.stage === undefined ? current.stage : (data.stage as string),
    progressCurrent:
      data.progressCurrent === undefined
        ? current.progressCurrent
        : (data.progressCurrent as bigint),
    attempt: incremented(current.attempt, data.attempt),
    version: incremented(current.version, data.version),
    queuedAt:
      data.queuedAt === undefined
        ? current.queuedAt
        : (data.queuedAt as Date | null),
    finishedAt:
      data.finishedAt === undefined
        ? current.finishedAt
        : (data.finishedAt as Date | null),
    cancelRequestedAt:
      data.cancelRequestedAt === undefined
        ? current.cancelRequestedAt
        : (data.cancelRequestedAt as Date | null),
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
    resultSummary:
      data.resultSummary === undefined ? current.resultSummary : null,
    errorSummary:
      data.errorSummary === undefined ? current.errorSummary : null
  } as StoredRankJob;
}

function applyRunMutation(
  current: RankJobRun,
  data: Readonly<Record<string, unknown>>
): RankJobRun {
  return {
    ...current,
    sealState:
      (data.sealState as RankJobRun["sealState"] | undefined) ??
      current.sealState,
    sealAttemptCount: incremented(
      current.sealAttemptCount,
      data.sealAttemptCount
    ),
    lastSealAttemptAt:
      data.lastSealAttemptAt === undefined
        ? current.lastSealAttemptAt
        : (data.lastSealAttemptAt as Date | null),
    manifestId:
      data.manifestId === undefined
        ? current.manifestId
        : (data.manifestId as string | null),
    manifestHashSchema:
      data.manifestHashSchema === undefined
        ? current.manifestHashSchema
        : (data.manifestHashSchema as string | null),
    manifestHash:
      data.manifestHash === undefined
        ? current.manifestHash
        : (data.manifestHash as Uint8Array<ArrayBuffer> | null),
    manifestDeduplicationHash:
      data.manifestDeduplicationHash === undefined
        ? current.manifestDeduplicationHash
        : (data.manifestDeduplicationHash as Uint8Array<ArrayBuffer> | null),
    manifestPairCount:
      data.manifestPairCount === undefined
        ? current.manifestPairCount
        : (data.manifestPairCount as number | null),
    manifestChunkCount:
      data.manifestChunkCount === undefined
        ? current.manifestChunkCount
        : (data.manifestChunkCount as number | null),
    manifestChunkSize:
      data.manifestChunkSize === undefined
        ? current.manifestChunkSize
        : (data.manifestChunkSize as number | null),
    manifestSealedAt:
      data.manifestSealedAt === undefined
        ? current.manifestSealedAt
        : (data.manifestSealedAt as Date | null),
    finalizationStatus:
      data.finalizationStatus === undefined
        ? current.finalizationStatus
        : (data.finalizationStatus as RankJobRun["finalizationStatus"]),
    finalizationRequestHash:
      data.finalizationRequestHash === undefined
        ? current.finalizationRequestHash
        : (data.finalizationRequestHash as Uint8Array<ArrayBuffer> | null),
    finalizedAt:
      data.finalizedAt === undefined
        ? current.finalizedAt
        : (data.finalizedAt as Date | null),
    cancelRequestedBy:
      data.cancelRequestedBy === undefined
        ? current.cancelRequestedBy
        : (data.cancelRequestedBy as string | null)
  };
}

function incremented(current: number, value: unknown): number {
  if (
    typeof value === "object" &&
    value !== null &&
    "increment" in value
  ) {
    return current + Number(value.increment);
  }
  return typeof value === "number" ? value : current;
}

function requiredRun(job: StoredRankJob): RankJobRun {
  if (!job.rankRun) throw new Error("Rank run fixture is missing");
  return job.rankRun;
}

function hash(value: string) {
  return {
    algorithm: "SHA_256" as const,
    value: value.repeat(64)
  };
}
