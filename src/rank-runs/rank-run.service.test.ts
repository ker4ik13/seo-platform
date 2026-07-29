import assert from "node:assert/strict";
import test from "node:test";
import type {
  InternalCancelRankJobInput,
  InternalCreateRankRunInput
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { QueueService } from "../queue/queue.service.js";
import type { RankManifestClient } from "../seo-data/rank-manifest.client.js";
import {
  rankRunRequestHash,
  type StoredRankJob
} from "./rank-job-record.js";
import { RankPreparationService } from "./rank-preparation.service.js";
import { RankRunService } from "./rank-run.service.js";

const workspaceId = "0190abcd-0000-7000-8000-000000000001";
const projectId = "0190abcd-0000-7000-8000-000000000002";
const actorId = "0190abcd-0000-7000-8000-000000000003";
const teamActorId = "0190abcd-0000-7000-8000-000000000004";
const estimateId = "0190abcd-0000-7000-8000-000000000005";
const trackingContextId = "0190abcd-0000-7000-8000-000000000006";
const membershipId = "0190abcd-0000-7000-8000-000000000007";
const jobId = "0190abcd-0000-7000-8000-000000000008";

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
      quota: {
        status: "AVAILABLE",
        limit: "10",
        used: "0",
        remaining: "10"
      }
    },
    billingCurrency: "RUB",
    ...overrides
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
