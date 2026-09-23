import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { OperationActivityService } from "./operation-activity.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const firstProjectId = "01900000-0000-7000-8000-000000000002";
const secondProjectId = "01900000-0000-7000-8000-000000000003";
const actorId = "01900000-0000-7000-8000-000000000004";
const jobId = "01900000-0000-7000-8000-000000000005";

test("counts only active user-visible operations by project", async () => {
  let query: unknown;
  const service = new OperationActivityService({
    job: {
      groupBy: async (value: unknown) => {
        query = value;
        return [
          { projectId: firstProjectId, _count: { _all: 2 } },
          { projectId: secondProjectId, _count: { _all: 1 } },
          { projectId: null, _count: { _all: 9 } }
        ];
      }
    }
  } as unknown as PrismaService);

  assert.deepEqual(await service.list(workspaceId), [
    { projectId: firstProjectId, activeOperationCount: 2 },
    { projectId: secondProjectId, activeOperationCount: 1 }
  ]);
  assert.deepEqual(query, {
    by: ["projectId"],
    where: {
      workspaceId,
      projectId: { not: null },
      type: {
        in: [
          "FREQUENCY_COLLECTION",
          "MANUAL_RANK_CHECK",
          "AI_ANSWER_COLLECTION",
          "CLUSTERING_RUN",
          "TECHNICAL_CRAWL",
          "KEYWORD_RESEARCH",
          "SEMANTIC_EXPORT"
        ]
      },
      status: {
        in: [
          "PREPARING",
          "QUEUED",
          "WAITING_RATE_LIMIT",
          "RUNNING",
          "CANCEL_REQUESTED",
          "RETRY_SCHEDULED",
          "FAILED_RETRYABLE"
        ]
      }
    },
    _count: { _all: true }
  });
});

test("dismisses a failed operation and advances the guarded Job version", async () => {
  const dismissedAt = new Date("2026-09-11T12:45:00.000Z");
  let lookup: unknown;
  let update: unknown;
  const transaction = {
    $queryRaw: async () => [{ now: dismissedAt }],
    job: {
      findFirst: async (value: unknown) => {
        lookup = value;
        return { id: jobId, status: "FAILED_FINAL", dismissedAt: null };
      },
      updateMany: async (value: unknown) => {
        update = value;
        return { count: 1 };
      }
    }
  };
  const service = new OperationActivityService({
    $transaction: async (run: (client: typeof transaction) => unknown) => run(transaction)
  } as unknown as PrismaService);

  assert.deepEqual(await service.dismiss({
    workspaceId,
    projectId: firstProjectId,
    actorId,
    operationId: jobId
  }), { operationId: jobId, dismissedAt: dismissedAt.toISOString() });
  assert.deepEqual(lookup, {
    where: {
      workspaceId,
      projectId: firstProjectId,
      type: {
        in: [
          "FREQUENCY_COLLECTION",
          "MANUAL_RANK_CHECK",
          "AI_ANSWER_COLLECTION",
          "CLUSTERING_RUN",
          "TECHNICAL_CRAWL",
          "KEYWORD_RESEARCH",
          "SEMANTIC_EXPORT"
        ]
      },
      OR: [
        { id: jobId },
        { technicalCrawl: { is: { id: jobId } } },
        { keywordResearchRun: { is: { id: jobId } } }
      ]
    },
    select: { id: true, status: true, dismissedAt: true }
  });
  assert.deepEqual(update, {
    where: {
      id: jobId,
      workspaceId,
      projectId: firstProjectId,
      status: { in: ["FAILED_FINAL", "ACTION_REQUIRED", "EXPIRED"] },
      dismissedAt: null
    },
    data: {
      dismissedAt,
      dismissedBy: actorId,
      version: { increment: 1 }
    }
  });
});

test("keeps completed operations visible and replays an existing dismissal", async () => {
  const dismissedAt = new Date("2026-09-11T12:45:00.000Z");
  const serviceFor = (current: Readonly<Record<string, unknown>>) =>
    new OperationActivityService({
      $transaction: async (run: (client: unknown) => unknown) => run({
        job: {
          findFirst: async () => current,
          updateMany: async () => {
            throw new Error("must not update");
          }
        }
      })
    } as unknown as PrismaService);
  const input = { workspaceId, projectId: firstProjectId, actorId, operationId: jobId };

  await assert.rejects(
    () => serviceFor({ id: jobId, status: "COMPLETED", dismissedAt: null }).dismiss(input),
    /not dismissible/iu
  );
  assert.deepEqual(
    await serviceFor({ id: jobId, status: "FAILED_FINAL", dismissedAt }).dismiss(input),
    { operationId: jobId, dismissedAt: dismissedAt.toISOString() }
  );
});

test("lists a bounded platform operation summary without raw job payloads", async () => {
  let countCall = 0;
  const countQueries: unknown[] = [];
  const createdAt = new Date("2026-08-11T18:00:00.000Z");
  const service = new OperationActivityService({
    job: {
      findMany: async () => [
        {
          id: "01900000-0000-7000-8000-000000000010",
          workspaceId,
          projectId: firstProjectId,
          actorId: "01900000-0000-7000-8000-000000000011",
          type: "MANUAL_RANK_CHECK",
          status: "RUNNING",
          stage: "COLLECTING",
          provider: "XMLSTOCK",
          progressCurrent: 17n,
          progressTotal: 50n,
          progressUnit: "KEYWORDS",
          actualCostMicro: null,
          currency: "RUB",
          attempt: 1,
          maxAttempts: 8,
          errorSummary: { code: "PROVIDER_DELAYED", secret: "must-not-leak" },
          resultSummary: {
            processedCount: 17,
            foundCount: 12,
            notFoundCount: 5,
            rawProviderResponse: "must-not-leak"
          },
          createdAt,
          queuedAt: createdAt,
          startedAt: createdAt,
          finishedAt: null,
          updatedAt: createdAt
        }
      ],
      count: async (value: unknown) => {
        countQueries.push(value);
        return [9, 2, 6, 1][countCall++] ?? 0;
      },
      groupBy: async () => [
        { type: "MANUAL_RANK_CHECK", _count: { _all: 7 } },
        { type: "FREQUENCY_COLLECTION", _count: { _all: 2 } }
      ]
    }
  } as unknown as PrismaService);

  const result = await service.adminList({ statusGroup: "ALL", limit: 50 });

  assert.deepEqual(result.totals, {
    total: 9,
    active: 2,
    completed: 6,
    attention: 1
  });
  assert.deepEqual(result.types, [
    { type: "MANUAL_RANK_CHECK", count: 7 },
    { type: "FREQUENCY_COLLECTION", count: 2 }
  ]);
  assert.deepEqual(result.data[0]?.progress, {
    current: "17",
    total: "50",
    unit: "KEYWORDS"
  });
  assert.deepEqual(result.data[0]?.result, {
    processed: 17,
    found: 12,
    notFound: 5
  });
  assert.equal(result.data[0]?.errorCode, "PROVIDER_DELAYED");
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak/u);
  assert.deepEqual(countQueries[1], {
    where: {
      AND: [
        {},
        {
          OR: [
            {
              status: {
                in: [
                  "ESTIMATING",
                  "AWAITING_APPROVAL",
                  "RESERVING_BALANCE",
                  "PREPARING",
                  "QUEUED",
                  "WAITING_RATE_LIMIT",
                  "RUNNING",
                  "PAUSE_REQUESTED",
                  "PAUSED",
                  "CANCEL_REQUESTED",
                  "RETRY_SCHEDULED"
                ]
              }
            },
            {
              status: "FAILED_RETRYABLE",
              type: { not: "INTEGRATION_CREDENTIAL_VALIDATE" }
            }
          ]
        }
      ]
    }
  });
  assert.deepEqual(countQueries[3], {
    where: {
      AND: [
        {},
        {
          OR: [
            { status: { in: ["FAILED_FINAL", "ACTION_REQUIRED"] } },
            {
              status: "FAILED_RETRYABLE",
              type: "INTEGRATION_CREDENTIAL_VALIDATE"
            }
          ]
        }
      ]
    }
  });
});

test("loads one safe platform operation summary for a deep link", async () => {
  const createdAt = new Date("2026-08-11T18:00:00.000Z");
  const service = new OperationActivityService({
    job: {
      findUnique: async () => ({
        id: jobId,
        workspaceId,
        projectId: firstProjectId,
        actorId,
        type: "MANUAL_RANK_CHECK",
        status: "RUNNING",
        stage: "WAITING_EXECUTION_GRANT",
        provider: "XMLSTOCK",
        progressCurrent: 18n,
        progressTotal: 50n,
        progressUnit: "KEYWORDS",
        actualCostMicro: null,
        currency: "RUB",
        attempt: 1,
        maxAttempts: 8,
        errorSummary: null,
        resultSummary: { foundCount: 18, raw: "must-not-leak" },
        createdAt,
        queuedAt: createdAt,
        startedAt: createdAt,
        finishedAt: null,
        updatedAt: createdAt
      })
    }
  } as unknown as PrismaService);

  const result = await service.adminDetail(jobId);
  assert.equal(result.id, jobId);
  assert.deepEqual(result.result, { found: 18 });
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak/u);
});

test("classifies exhausted credential validation as attention", async () => {
  let findManyQuery: unknown;
  const service = new OperationActivityService({
    job: {
      findMany: async (value: unknown) => {
        findManyQuery = value;
        return [];
      },
      count: async () => 0,
      groupBy: async () => []
    }
  } as unknown as PrismaService);

  await service.adminList({ statusGroup: "ATTENTION", limit: 50 });

  assert.deepEqual(findManyQuery, {
    where: {
      AND: [
        {},
        {
          OR: [
            { status: { in: ["FAILED_FINAL", "ACTION_REQUIRED"] } },
            {
              status: "FAILED_RETRYABLE",
              type: "INTEGRATION_CREDENTIAL_VALIDATE"
            }
          ]
        }
      ]
    },
    select: {
      id: true,
      workspaceId: true,
      projectId: true,
      actorId: true,
      type: true,
      status: true,
      stage: true,
      provider: true,
      progressCurrent: true,
      progressTotal: true,
      progressUnit: true,
      actualCostMicro: true,
      currency: true,
      attempt: true,
      maxAttempts: true,
      errorSummary: true,
      resultSummary: true,
      createdAt: true,
      queuedAt: true,
      startedAt: true,
      finishedAt: true,
      updatedAt: true
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51
  });
});
