import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import type { RankOperationProvenanceService } from "../rank-runs/rank-operation-provenance.service.js";
import { OperationActivityService } from "./operation-activity.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const firstProjectId = "01900000-0000-7000-8000-000000000002";
const secondProjectId = "01900000-0000-7000-8000-000000000003";
const actorId = "01900000-0000-7000-8000-000000000004";
const jobId = "01900000-0000-7000-8000-000000000005";

function activityService(prisma: PrismaService, provenance: RankOperationProvenanceService = { selectedForJobs: async () => new Map() } as unknown as RankOperationProvenanceService): OperationActivityService {
  return new OperationActivityService(Object.assign({ $queryRaw: async () => [], semanticImport: { findMany: async () => [], findUnique: async () => null, groupBy: async () => [], count: async () => 0 } }, prisma) as PrismaService, provenance);
}

test("counts only active user-visible operations by project", async () => {
  let query: unknown;
  const service = activityService({
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
          "PAGE_STATUS_CHANGE",
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
  const service = activityService({
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
          "PAGE_STATUS_CHANGE",
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
    activityService({
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
  const listQueries: unknown[] = [];
  const typeQueries: unknown[] = [];
  const createdAt = new Date("2026-08-11T18:00:00.000Z");
  const service = activityService({
    job: {
      findMany: async (query: unknown) => {
        listQueries.push(query);
        return [
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
        ];
      },
      count: async (value: unknown) => {
        countQueries.push(value);
        return [9, 2, 6, 1][countCall++] ?? 0;
      },
      groupBy: async (query: unknown) => {
        typeQueries.push(query);
        return [
        { type: "MANUAL_RANK_CHECK", _count: { _all: 7 } },
        { type: "FREQUENCY_COLLECTION", _count: { _all: 2 } }
        ];
      }
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
  const filtered = await service.adminList({ statusGroup: "COMPLETED", type: "FREQUENCY_COLLECTION", limit: 50 });
  assert.deepEqual(filtered.types, result.types, "choosing one type cannot remove the others from the selector");
  assert.deepEqual((typeQueries[1] as {where: {type: {in: string[]}}}).where.type.in,
    (typeQueries[0] as {where: {type: {in: string[]}}}).where.type.in);
  assert.equal((listQueries[1] as {where: {AND: Array<{type?: string}>}}).where.AND[0]?.type, "FREQUENCY_COLLECTION");
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
  const filteredTypes = (countQueries[1] as { where: { AND: unknown[] } }).where.AND[0];
  assert.deepEqual(filteredTypes, { type: { in: [
    "PAGE_STATUS_CHANGE", "FREQUENCY_COLLECTION", "MANUAL_RANK_CHECK", "AI_ANSWER_COLLECTION",
    "CLUSTERING_RUN", "TECHNICAL_CRAWL", "KEYWORD_RESEARCH", "SEMANTIC_EXPORT"
  ] } });
  assert.deepEqual((countQueries[1] as { where: { AND: unknown[] } }).where.AND[1], {
    OR: [
      { status: { in: ["ESTIMATING", "AWAITING_APPROVAL", "RESERVING_BALANCE", "PREPARING", "QUEUED", "WAITING_RATE_LIMIT", "RUNNING", "PAUSE_REQUESTED", "PAUSED", "CANCEL_REQUESTED", "RETRY_SCHEDULED"] } },
      { status: "FAILED_RETRYABLE" }
    ]
  });
  assert.deepEqual((countQueries[3] as { where: { AND: unknown[] } }).where.AND, [
    filteredTypes, { status: { in: ["FAILED_FINAL", "ACTION_REQUIRED"] } }
  ]);
});

test("admin operation row includes search engine, exact connection and active workers", async () => {
  const createdAt = new Date("2026-08-11T18:00:00.000Z");
  const rankJobId = "01900000-0000-7000-8000-000000000010";
  const nodeId = "01900000-0000-7000-8000-000000000012";
  const idleNodeId = "01900000-0000-7000-8000-000000000013";
  const prisma = {
    job: {
      findMany: async () => [{
        id: rankJobId, workspaceId, projectId: firstProjectId,
        actorId, type: "MANUAL_RANK_CHECK", status: "RUNNING",
        stage: "COLLECTING", provider: "XMLSTOCK",
        credentialMode: "BYOK_API_KEY",
        scopeSnapshot: { searchEngine: "YANDEX", privateKey: "must-not-leak" },
        progressCurrent: 4n, progressTotal: 50n, progressUnit: "KEYWORDS",
        actualCostMicro: null, currency: "RUB", attempt: 1,
        maxAttempts: 8, errorSummary: null, resultSummary: null,
        createdAt, queuedAt: createdAt, startedAt: createdAt,
        finishedAt: null, updatedAt: createdAt
      }],
      count: async () => 1,
      groupBy: async () => []
    },
    $queryRaw: async (query: TemplateStringsArray) => query.join("").includes("list_remote_work_assignments") ? [] :
      query.join("").includes("COUNT(DISTINCT assigned.job_id)") ? [{ nodeId, assignedOperations: 2n }] : [
        { nodeId: "main", jobId: rankJobId, activeTasks: 1n },
        { nodeId, jobId: rankJobId, activeTasks: 3n },
        { nodeId: idleNodeId, jobId: rankJobId, activeTasks: 0n }
      ],
    executionWorkerNode: {
      findMany: async () => [{ id: nodeId, name: "Офисный воркер", enabled: true,
        draining: false, deletedAt: null, lastHeartbeatAt: new Date() }]
    }
  } as unknown as PrismaService;
  const service = activityService(prisma, {
    selectedForJobs: async () => new Map([[rankJobId,
      { label: "Личный", displayHint: "••••b313" }]])
  } as unknown as RankOperationProvenanceService);
  const page = await service.adminList({ statusGroup: "ACTIVE", limit: 50 });
  assert.deepEqual(page.data[0]?.connection,
    { label: "Личный", displayHint: "••••b313" });
  assert.equal(page.data[0]?.searchEngine, "YANDEX");
  assert.deepEqual(page.data[0]?.workers, [
    { name: "Основной сервер", activeTasks: 1, status: "MAIN", assignedOperations: 1 },
    { name: "Офисный воркер", nodeId, activeTasks: 3, status: "ONLINE", assignedOperations: 2 }
  ]);
  assert.doesNotMatch(JSON.stringify(page), /must-not-leak/u);
});

test("admin AI answer operation keeps Arsenkin progress separate from saved keywords", async () => {
  const createdAt = new Date("2026-10-07T07:13:19.000Z");
  const prisma = {
    job: {
      findMany: async () => [{
        id: jobId, workspaceId, projectId: firstProjectId,
        actorId, type: "AI_ANSWER_COLLECTION", status: "RETRY_SCHEDULED",
        stage: "provider_poll", provider: "ARSENKIN",
        credentialMode: "BYOK_API_KEY",
        scopeSnapshot: { searchEngine: "YANDEX" },
        progressCurrent: 0n, progressTotal: 110n, progressUnit: "KEYWORDS",
        providerProgressPercent: 87,
        actualCostMicro: null, currency: "RUB", attempt: 17,
        maxAttempts: 720, errorSummary: null, resultSummary: null,
        createdAt, queuedAt: createdAt, startedAt: createdAt,
        finishedAt: null, updatedAt: createdAt
      }],
      count: async () => 1,
      groupBy: async () => []
    },
    $queryRaw: async () => []
  } as unknown as PrismaService;
  const service = activityService(prisma, {
    selectedForJobs: async () => new Map()
  } as unknown as RankOperationProvenanceService);
  const operation = (await service.adminList({ statusGroup: "ACTIVE", limit: 50 })).data[0];
  assert.deepEqual(operation?.progress, { current: "0", total: "110", unit: "KEYWORDS" });
  assert.equal(operation?.providerProgressPercent, 87);
});

test("running Wordstat shows its own key and main server without rank scans", async () => {
  const createdAt = new Date("2026-08-11T18:00:00.000Z");
  const prisma = {
    job: {
      findUnique: async () => ({
        id: jobId, workspaceId, projectId: firstProjectId, actorId,
        type: "FREQUENCY_COLLECTION", status: "RUNNING", stage: "collecting",
        provider: "XMLSTOCK", credentialMode: "BYOK_API_KEY",
        scopeSnapshot: { credentialId: "01900000-0000-7000-8000-000000000020" },
        progressCurrent: 1n, progressTotal: 10n, progressUnit: "keywords",
        actualCostMicro: null, currency: "RUB", attempt: 1,
        maxAttempts: 8, errorSummary: null, resultSummary: null,
        createdAt, queuedAt: createdAt, startedAt: createdAt,
        finishedAt: null, updatedAt: createdAt
      })
    },
    $queryRaw: async (query: TemplateStringsArray) => {
      if (query.join("").includes("input_snapshot->>'mode'")) return [{ jobId, mode: "SEASONALITY", failureCode: null }];
      assert.ok(query.join("").includes("list_remote_work_assignments"));
      return [];
    }
  } as unknown as PrismaService;
  const service = activityService(prisma, {
    selectedForJobs: async (jobs: readonly { readonly credentialId?: string }[]) => {
      assert.equal(jobs[0]?.credentialId,
        "01900000-0000-7000-8000-000000000020");
      return new Map([[jobId, { label: "Wordstat ключ" }]]);
    }
  } as unknown as RankOperationProvenanceService);
  const result = await service.adminDetail(jobId);
  assert.equal(result.searchEngine, "YANDEX");
  assert.equal(result.frequencyMode, "SEASONALITY");
  assert.deepEqual(result.connection, { label: "Wordstat ключ" });
  assert.deepEqual(result.workers,
    [{ name: "Основной сервер", activeTasks: 0, status: "MAIN", assignedOperations: 1 }]);
});

test("admin Wordstat projects low balance from failed items without exposing the input snapshot", async () => {
  const createdAt = new Date("2026-10-01T15:54:00.000Z");
  const service = activityService({
    job: {
      findUnique: async () => ({
        id: jobId, workspaceId, projectId: firstProjectId, actorId,
        type: "FREQUENCY_COLLECTION", status: "CANCELLED", stage: "collecting",
        provider: "XMLSTOCK", credentialMode: "BYOK_API_KEY",
        scopeSnapshot: {}, progressCurrent: 8n, progressTotal: 65n,
        progressUnit: "keywords", actualCostMicro: null, currency: "RUB",
        attempt: 1, maxAttempts: 8,
        errorSummary: { code: "ITEMS_FAILED" }, resultSummary: null,
        createdAt, queuedAt: createdAt, startedAt: createdAt,
        finishedAt: createdAt, updatedAt: createdAt
      })
    },
    $queryRaw: async (query: TemplateStringsArray) => query.join("").includes("input_snapshot->>'mode'")
      ? [{ jobId, mode: "SEASONALITY", failureCode: "PROVIDER_LOW_BALANCE" }]
      : []
  } as unknown as PrismaService);
  const detail = await service.adminDetail(jobId);
  assert.equal(detail.frequencyMode, "SEASONALITY");
  assert.equal(detail.errorCode, "PROVIDER_LOW_BALANCE");
  assert.doesNotMatch(JSON.stringify(detail), /inputSnapshot|rawProviderResponse|secret/u);
});

test("loads one safe platform operation summary for a deep link", async () => {
  const createdAt = new Date("2026-08-11T18:00:00.000Z");
  const service = activityService({
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

test("excludes credential validation from the admin journal, including explicit type filters", async () => {
  let findManyQuery: unknown;
  const service = activityService({
    job: {
      findMany: async (value: unknown) => {
        findManyQuery = value;
        return [];
      },
      count: async () => 0,
      groupBy: async () => []
    }
  } as unknown as PrismaService);

  await service.adminList({ statusGroup: "ATTENTION", type: "INTEGRATION_CREDENTIAL_VALIDATE", limit: 50 });
  assert.deepEqual((findManyQuery as { where: { AND: unknown[] } }).where.AND, [
    { type: { in: [] } }, { status: { in: ["FAILED_FINAL", "ACTION_REQUIRED"] } }
  ]);
});

test("admin overview aggregates only user-visible operation types", async () => {
  const countQueries: unknown[] = [];
  let groupedWhere: unknown;
  const service = activityService({ job: {
    count: async (query: unknown) => { countQueries.push(query); return 0; },
    groupBy: async ({ where }: { where: unknown }) => { groupedWhere = where; return []; }
  } } as unknown as PrismaService);
  await service.overview();
  assert.equal(countQueries.length, 5);
  for (const query of [...countQueries, { where: groupedWhere }]) {
    const types = (query as { where: { type: { in: readonly string[] } } }).where.type.in;
    assert.ok(types.includes("MANUAL_RANK_CHECK"));
    assert.ok(!types.includes("INTEGRATION_CREDENTIAL_VALIDATE"));
  }
});
