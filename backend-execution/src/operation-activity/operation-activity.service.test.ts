import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { OperationActivityService } from "./operation-activity.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const firstProjectId = "01900000-0000-7000-8000-000000000002";
const secondProjectId = "01900000-0000-7000-8000-000000000003";

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
          "TECHNICAL_CRAWL",
          "KEYWORD_RESEARCH"
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

test("lists a bounded platform operation summary without raw job payloads", async () => {
  let countCall = 0;
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
      count: async () => [9, 2, 6, 1][countCall++] ?? 0,
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
});
