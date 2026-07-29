import assert from "node:assert/strict";
import test from "node:test";
import type {
  InternalSealRankManifestInput,
  RankJobSummary
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { RankJobRun } from "../generated/prisma/client.js";
import {
  RankManifestClientError,
  type RankManifestClient
} from "../seo-data/rank-manifest.client.js";
import {
  toRankJobSummary,
  type StoredRankJob
} from "./rank-job-record.js";
import { rankManifestCommandHash } from "./rank-manifest-command.js";
import {
  RankPreparationService,
  rankPreparationRetryDelayMilliseconds
} from "./rank-preparation.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const estimateId = "01900000-0000-7000-8000-000000000005";
const trackingContextId = "01900000-0000-7000-8000-000000000006";
const leaseOwner = "rank-worker-action-required";
const now = new Date("2026-07-29T12:01:00.000Z");

test("adds bounded stable jitter to preparation retries", () => {
  const jobIds = Array.from({ length: 16 }, (_, index) =>
    `01900000-0000-7000-8000-${index.toString(16).padStart(12, "0")}`
  );
  const firstAttempt = jobIds.map((id) =>
    rankPreparationRetryDelayMilliseconds(id, 1)
  );
  const firstJobId = jobIds[0];

  assert.ok(firstJobId);
  assert.ok(firstAttempt.every((delay) => delay >= 8_000));
  assert.ok(firstAttempt.every((delay) => delay <= 12_000));
  assert.ok(new Set(firstAttempt).size > 1);
  assert.equal(
    rankPreparationRetryDelayMilliseconds(firstJobId, 1),
    firstAttempt[0]
  );
  assert.ok(
    rankPreparationRetryDelayMilliseconds(firstJobId, 20) >= 55_000
  );
  assert.ok(
    rankPreparationRetryDelayMilliseconds(firstJobId, 20) <= 60_000
  );
});

for (const code of ["IDEMPOTENCY_CONFLICT", "INVALID_COMMAND"] as const) {
  test(`${code} from manifest seal remains outcome-unknown and requires operator action`, async () => {
    const harness = preparationHarness(
      new RankManifestClientError(code, false)
    );

    const summary = await harness.service.process(jobId, leaseOwner);
    const stored = harness.stored();

    assert.equal(harness.sealCalls(), 1);
    assert.equal(stored.status, "ACTION_REQUIRED");
    assert.equal(stored.stage, "SUBMIT_OUTCOME_UNKNOWN");
    assert.equal(stored.rankRun?.sealState, "OUTCOME_UNKNOWN");
    assert.equal(
      harness.sealStateTransitions().includes("NOT_SEALED"),
      false
    );
    assert.equal(stored.retryAt, null);
    assertActionRequiredSummary(summary);
  });
}

test("UNAVAILABLE at maxAttempts becomes ACTION_REQUIRED without scheduling another retry", async () => {
  const harness = preparationHarness(
    new RankManifestClientError("UNAVAILABLE", true),
    { attempt: 2, maxAttempts: 3 }
  );

  const summary = await harness.service.process(jobId, leaseOwner);
  const stored = harness.stored();

  assert.equal(harness.sealCalls(), 1);
  assert.equal(stored.attempt, 3);
  assert.equal(stored.maxAttempts, 3);
  assert.equal(stored.status, "ACTION_REQUIRED");
  assert.equal(stored.rankRun?.sealState, "OUTCOME_UNKNOWN");
  assert.equal(stored.retryAt, null);
  assert.equal(stored.leaseOwner, null);
  assert.equal(stored.leaseExpiresAt, null);
  assert.equal(harness.retryAssignments(), 0);
  assertActionRequiredSummary(summary);
});

test("an already exhausted preparation terminalizes without another network call", async () => {
  const harness = preparationHarness(
    new RankManifestClientError("UNAVAILABLE", true),
    { attempt: 3, maxAttempts: 3 }
  );

  const summary = await harness.service.process(jobId, leaseOwner);
  const stored = harness.stored();

  assert.equal(harness.sealCalls(), 0);
  assert.equal(stored.attempt, 3);
  assert.equal(stored.status, "ACTION_REQUIRED");
  assert.equal(stored.rankRun?.sealState, "PENDING");
  assert.equal(harness.retryAssignments(), 0);
  assertActionRequiredSummary(summary);
});

test("a self-consistent command for another Job never leaves the service boundary", async () => {
  const foreignCommand = {
    ...manifestCommand(),
    jobId: "01900000-0000-7000-8000-000000000099"
  };
  const baseline = rankJob();
  const harness = preparationHarness(
    new RankManifestClientError("UNAVAILABLE", true),
    {
      rankRun: {
        ...requiredRun(baseline),
        manifestCommand: foreignCommand,
        manifestCommandHash: rankManifestCommandHash(foreignCommand)
      }
    }
  );

  const summary = await harness.service.process(jobId, leaseOwner);
  const stored = harness.stored();

  assert.equal(harness.sealCalls(), 0);
  assert.equal(stored.status, "ACTION_REQUIRED");
  assert.equal(stored.rankRun?.sealState, "OUTCOME_UNKNOWN");
  assert.equal(
    harness.sealStateTransitions().includes("NOT_SEALED"),
    false
  );
  assertActionRequiredSummary(summary);
});

test("known ESTIMATE_EXPIRED proves NOT_SEALED and terminates the Job as EXPIRED", async () => {
  const harness = preparationHarness(
    new RankManifestClientError("ESTIMATE_EXPIRED", false)
  );

  const summary = await harness.service.process(jobId, leaseOwner);
  const stored = harness.stored();

  assert.equal(harness.sealCalls(), 1);
  assert.equal(stored.status, "EXPIRED");
  assert.equal(stored.stage, "FINISHED");
  assert.deepEqual(stored.errorSummary, { code: "ESTIMATE_EXPIRED" });
  assert.equal(stored.rankRun?.sealState, "NOT_SEALED");
  assert.deepEqual(harness.sealStateTransitions(), [
    "OUTCOME_UNKNOWN",
    "NOT_SEALED"
  ]);
  assert.equal(stored.retryAt, null);
  assert.equal(summary.status, "FAILED");
  assert.deepEqual(summary.failure, { code: "ESTIMATE_EXPIRED" });
  assert.equal(summary.finishedAt, now.toISOString());
});

test("ACTION_REQUIRED projection accepts only exact all-unknown terminal evidence", () => {
  const stored = rankJob({
    status: "ACTION_REQUIRED",
    stage: "SUBMIT_OUTCOME_UNKNOWN",
    finishedAt: now,
    errorSummary: { code: "SUBMIT_OUTCOME_UNKNOWN" },
    resultSummary: unknownResult()
  });

  assertActionRequiredSummary(toRankJobSummary(stored));
  assert.throws(
    () =>
      toRankJobSummary({
        ...stored,
        resultSummary: {
          ...unknownResult(),
          providerRequestId: "must-not-leak"
        }
      }),
    /Invalid stored manual rank Job/u
  );
  assert.throws(
    () =>
      toRankJobSummary({
        ...stored,
        resultSummary: {
          ...unknownResult(),
          submitOutcomeUnknownCount: "2"
        }
      }),
    /Invalid stored manual rank Job/u
  );
});

function preparationHarness(
  sealError: RankManifestClientError,
  jobOverrides: Readonly<Record<string, unknown>> = {}
): {
  readonly service: RankPreparationService;
  readonly stored: () => StoredRankJob;
  readonly sealCalls: () => number;
  readonly sealStateTransitions: () => readonly string[];
  readonly retryAssignments: () => number;
} {
  let stored = rankJob(jobOverrides);
  let calls = 0;
  let retries = 0;
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
        if (data.retryAt instanceof Date) retries += 1;
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
          (where.sealState !== undefined &&
            where.sealState !== run.sealState) ||
          (where.sealAttemptCount !== undefined &&
            where.sealAttemptCount !== run.sealAttemptCount)
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
    $queryRaw: async (query: TemplateStringsArray) =>
      query.join("").includes("clock_timestamp")
        ? [{ now }]
        : [{ id: jobId }]
  };
  const prisma = {
    job: transaction.job,
    $transaction: async (
      operation: (value: typeof transaction) => Promise<unknown>
    ) => operation(transaction)
  } as unknown as PrismaService;
  const manifests = {
    seal: async () => {
      calls += 1;
      throw sealError;
    },
    finalize: async () => {
      throw new Error("finalize must not run for an unsealed preparation");
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

  return {
    service: new RankPreparationService(prisma, manifests, config),
    stored: () => stored,
    sealCalls: () => calls,
    sealStateTransitions: () => transitions,
    retryAssignments: () => retries
  };
}

function rankJob(
  overrides: Readonly<Record<string, unknown>> = {}
): StoredRankJob {
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
    maxAttempts: 3,
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
    },
    ...overrides
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
    errorSummary:
      data.errorSummary === undefined
        ? current.errorSummary
        : data.errorSummary,
    resultSummary:
      data.resultSummary === undefined
        ? current.resultSummary
        : data.resultSummary,
    finishedAt:
      data.finishedAt === undefined
        ? current.finishedAt
        : (data.finishedAt as Date | null),
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
        : (data.retryAt as Date | null)
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
        : (data.lastSealAttemptAt as Date | null)
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
  if (!job.rankRun) throw new Error("Rank run is required");
  return job.rankRun;
}

function unknownResult() {
  return {
    pairCount: "3",
    persistedCount: "0",
    foundCount: "0",
    notFoundCount: "0",
    failedCount: "0",
    submitOutcomeUnknownCount: "3"
  };
}

function assertActionRequiredSummary(summary: RankJobSummary): void {
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
    status: "ACTION_REQUIRED",
    stage: "SUBMIT_OUTCOME_UNKNOWN",
    result: unknownResult(),
    failure: { code: "SUBMIT_OUTCOME_UNKNOWN" },
    createdAt: "2026-07-29T12:00:00.000Z",
    finishedAt: now.toISOString()
  });
}

function hash(value: string) {
  return {
    algorithm: "SHA_256" as const,
    value: value.repeat(64)
  };
}
