import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";
import type { FrequencyCollectionSummary } from "@seo-platform/contracts";
import {
  FrequencyCollectionService,
  frequencyJobItems
} from "./frequency-collection.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const route = {
  resolve: async () => ({
    bindingId: "01900000-0000-7000-8000-000000000006",
    bindingVersion: 1,
    routeId: "01900000-0000-7000-8000-000000000007",
    credentialId: "01900000-0000-7000-8000-000000000008",
    provider: "ARSENKIN" as const,
    credentialMode: "BYOK_API_KEY" as const,
    routingScope: "PROJECT_OVERRIDE" as const,
    position: 0,
    attempts: []
  })
};

test("nested frequency items inherit workspace scope from their parent Job", () => {
  assert.deepEqual(
    frequencyJobItems({
      projectId,
      items: [{ id: jobId, version: 3 }]
    }),
    [{
      projectId,
      sequence: 0,
      status: "PENDING",
      inputReference: { keywordId: jobId, version: 3 }
    }]
  );
  assert.equal("workspaceId" in frequencyJobItems({
    projectId,
    items: [{ id: jobId, version: 3 }]
  })[0]!, false);
});

test("creates all 10,000 Arsenkin items atomically in bounded SQL batches", async () => {
  const batchSizes: number[] = [];
  const storedRows: Array<Readonly<Record<string, unknown>>> = [];
  let createData: Readonly<Record<string, unknown>> | undefined;
  let transactionOptions: unknown;
  const createdAt = new Date("2026-08-02T00:00:00.000Z");
  const createdJob = {
    id: jobId,
    workspaceId,
    projectId,
    provider: "ARSENKIN",
    status: "QUEUED",
    stage: "collecting",
    progressTotal: 10_000n,
    progressCurrent: 0n,
    resultSummary: null,
    errorSummary: null,
    inputSnapshot: { types: ["BASE"], regionCode: "213", device: "ALL" },
    retryAt: null,
    version: 1,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: null
  };
  const transaction = {
    $executeRaw: async () => 1,
    job: {
      count: async () => 0,
      create: async ({ data }: { readonly data: Readonly<Record<string, unknown>> }) => {
        createData = data;
        return createdJob;
      }
    },
    semanticImport: {
      count: async () => 0
    },
    jobItem: {
      createMany: async ({ data }: { readonly data: readonly Readonly<Record<string, unknown>>[] }) => {
        batchSizes.push(data.length);
        storedRows.push(...data);
        return { count: data.length };
      }
    }
  };
  const prisma = {
    job: { findUnique: async () => null },
    projectConnectorBinding: {
      findUnique: async () => ({
        id: "01900000-0000-7000-8000-000000000006",
        enabled: true,
        routes: [{
          id: "01900000-0000-7000-8000-000000000007",
          position: 0,
          credentialId: "01900000-0000-7000-8000-000000000008",
          credential: {
            provider: "ARSENKIN",
            mode: "BYOK_API_KEY",
            status: "ACTIVE",
            deletedAt: null,
            capabilities: ["WORDSTAT"]
          }
        }]
      })
    },
    $transaction: async (
      callback: (value: typeof transaction) => Promise<unknown>,
      options: unknown
    ) => {
      transactionOptions = options;
      return callback(transaction);
    }
  };
  const result = await new FrequencyCollectionService(
    prisma as never,
    route as never
  ).create({
    workspaceId,
    projectId,
    actorId,
    idempotencyKey: "frequency-create-10000",
    correlationId: "correlation-10000",
    jobCapacity: {
      planCode: "TEAM",
      planVersion: 3,
      concurrentJobs: 10
    },
    items: Array.from({ length: 10_000 }, (_, index) => ({
      id: `01900000-0000-7000-8000-${String(index + 100).padStart(12, "0")}`,
      version: 1
    })),
    types: ["BASE"],
    regionCode: "213",
    device: "ALL"
  });

  assert.equal(result.selectedKeywords, 10_000);
  assert.deepEqual(batchSizes, [2_000, 2_000, 2_000, 2_000, 2_000]);
  assert.equal(storedRows.length, 10_000);
  assert.equal(new Set(storedRows.map((row) => row.sequence)).size, 10_000);
  assert.ok(storedRows.every((row) =>
    row.workspaceId === workspaceId && row.jobId === jobId
  ));
  assert.equal("items" in (createData ?? {}), false);
  assert.equal(createData?.maxAttempts, 720);
  assert.deepEqual(transactionOptions, { maxWait: 5_000, timeout: 30_000 });
});

test("accepts 10,000 XMLStock keywords at the collection boundary", async () => {
  const reachedTransaction = new Error("transaction reached");
  const xmlStockRoute = {
    resolve: async () => ({
      ...(await route.resolve()),
      provider: "XMLSTOCK" as const
    })
  };
  const service = new FrequencyCollectionService(
    {
      job: { findUnique: async () => null },
      $transaction: async () => {
        throw reachedTransaction;
      }
    } as never,
    xmlStockRoute as never
  );
  await assert.rejects(
    service.create({
      workspaceId,
      projectId,
      actorId,
      idempotencyKey: "xmlstock-frequency-create-10000",
      correlationId: "xmlstock-correlation-10000",
      jobCapacity: {
        planCode: "TEAM",
        planVersion: 3,
        concurrentJobs: 10
      },
      items: Array.from({ length: 10_000 }, (_, index) => ({
        id: `keyword-${index}`,
        version: 1
      })),
      types: ["BASE"],
      regionCode: "225",
      device: "ALL"
    }),
    (error) => error === reachedTransaction
  );
});

test("returns an exact tenant-scoped result scope without provider payloads", async () => {
  let observedWhere: unknown;
  const prisma = {
    job: {
      findFirst: async ({ where }: { where: unknown }) => {
        observedWhere = where;
        return {
          items: [
            {
              sequence: 0,
              status: "COMPLETED",
              inputReference: { keywordId: jobId, version: 3 },
              error: null
            },
            {
              sequence: 1,
              status: "FAILED_FINAL",
              inputReference: {
                keywordId: "01900000-0000-7000-8000-000000000005",
                version: 1
              },
              error: { code: "PROVIDER_REJECTED", secret: "must-not-leak" }
            }
          ]
        };
      }
    }
  };
  const result = await new FrequencyCollectionService(
    prisma as never,
    route as never
  ).resultScope(workspaceId, projectId, jobId, 200);

  assert.deepEqual(observedWhere, {
    id: jobId,
    workspaceId,
    projectId,
    type: "FREQUENCY_COLLECTION"
  });
  assert.deepEqual(result.items, [
    { sequence: 0, keywordId: jobId, status: "COMPLETED" },
    {
      sequence: 1,
      keywordId: "01900000-0000-7000-8000-000000000005",
      status: "FAILED_FINAL",
      errorCode: "PROVIDER_REJECTED"
    }
  ]);
  assert.deepEqual(result.page, { hasNext: false });
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak/u);
});

test("cancellation uses authoritative active state instead of a stale browser version", async () => {
  let jobUpdate: unknown;
  let itemUpdate: unknown;
  const transaction = {
    job: {
      findFirst: async () => ({ version: 41, status: "RUNNING" }),
      updateMany: async (input: unknown) => {
        jobUpdate = input;
        return { count: 1 };
      }
    },
    jobItem: {
      updateMany: async (input: unknown) => {
        itemUpdate = input;
        return { count: 4 };
      }
    }
  };
  const prisma = {
    $transaction: async (callback: (value: typeof transaction) => Promise<void>) =>
      callback(transaction)
  };
  const result = await new CancelHarness(
    prisma as never,
    route as never
  ).cancel(jobId, { workspaceId, projectId, actorId });

  assert.equal(result.status, "CANCELLED");
  const where = (jobUpdate as { readonly where: Record<string, unknown> }).where;
  assert.equal("version" in where, false);
  assert.deepEqual(where.status, {
    in: [
      "QUEUED",
      "RUNNING",
      "WAITING_RATE_LIMIT",
      "RETRY_SCHEDULED",
      "FAILED_RETRYABLE"
    ]
  });
  assert.deepEqual(
    (itemUpdate as { readonly data: unknown }).data,
    { status: "CANCELLED", retryAt: null }
  );
});

test("frequency cancellation replays an already terminal state without writes", async () => {
  const transaction = {
    job: {
      findFirst: async () => ({ version: 42, status: "CANCELLED" }),
      updateMany: async () => {
        throw new Error("terminal cancellation must not update the Job");
      }
    },
    jobItem: {
      updateMany: async () => {
        throw new Error("terminal cancellation must not update Job items");
      }
    }
  };
  const prisma = {
    $transaction: async (callback: (value: typeof transaction) => Promise<void>) =>
      callback(transaction)
  };

  const result = await new CancelHarness(
    prisma as never,
    route as never
  ).cancel(jobId, { workspaceId, projectId, actorId });

  assert.equal(result.status, "CANCELLED");
});

test("manual retry resets only failed items and preserves completed progress", async () => {
  let itemUpdate: unknown;
  let jobUpdate: unknown;
  const transaction = {
    job: {
      findFirst: async () => ({ version: 7, status: "PARTIALLY_COMPLETED" }),
      updateMany: async (input: unknown) => {
        jobUpdate = input;
        return { count: 1 };
      }
    },
    jobItem: {
      updateMany: async (input: unknown) => {
        itemUpdate = input;
        return { count: 2 };
      },
      count: async () => 3
    }
  };
  const prisma = {
    $transaction: async (callback: (value: typeof transaction) => Promise<void>) =>
      callback(transaction)
  };
  const service = new RetryHarness(prisma as never, route as never);
  const result = await service.retryFailed(jobId, {
    workspaceId,
    projectId,
    actorId,
    version: 7
  });
  assert.equal(result.status, "QUEUED");
  assert.deepEqual(
    (itemUpdate as { where: unknown }).where,
    { jobId, status: "FAILED_FINAL" }
  );
  assert.deepEqual(
    (jobUpdate as { data: { status: string; progressCurrent: bigint } }).data.status,
    "QUEUED"
  );
  assert.equal(
    (jobUpdate as { data: { progressCurrent: bigint } }).data.progressCurrent,
    3n
  );
});

test("manual retry cannot resubmit an ambiguous paid Arsenkin task", async () => {
  let touchedItems = false;
  const transaction = {
    job: {
      findFirst: async () => ({ version: 9, status: "ACTION_REQUIRED" })
    },
    jobItem: {
      updateMany: async () => {
        touchedItems = true;
        return { count: 1 };
      }
    }
  };
  const prisma = {
    $transaction: async (callback: (value: typeof transaction) => Promise<void>) =>
      callback(transaction)
  };
  const service = new FrequencyCollectionService(prisma as never, route as never);
  await assert.rejects(
    service.retryFailed(jobId, {
      workspaceId,
      projectId,
      actorId,
      version: 9
    }),
    (error: unknown) =>
      error instanceof ConflictException &&
      /manual provider reconciliation/u.test(error.message)
  );
  assert.equal(touchedItems, false);
});

class RetryHarness extends FrequencyCollectionService {
  public override async get(): Promise<FrequencyCollectionSummary> {
    return {
      id: jobId,
      workspaceId,
      projectId,
      provider: "XMLSTOCK",
      status: "QUEUED",
      selectedKeywords: 5,
      completedKeywords: 3,
      failedKeywords: 0,
      types: ["BASE"],
      regionCode: "213",
      device: "ALL",
      version: 8,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:01.000Z"
    };
  }
}

class CancelHarness extends FrequencyCollectionService {
  public override async get(): Promise<FrequencyCollectionSummary> {
    return {
      id: jobId,
      workspaceId,
      projectId,
      provider: "XMLSTOCK",
      status: "CANCELLED",
      selectedKeywords: 5,
      completedKeywords: 1,
      failedKeywords: 0,
      types: ["BASE"],
      regionCode: "213",
      device: "ALL",
      version: 42,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:01.000Z",
      finishedAt: "2026-08-01T00:00:01.000Z"
    };
  }
}
