import assert from "node:assert/strict";
import test from "node:test";
import type {
  SemanticKeywordListItem,
  SemanticPositionHistoryExportRow
} from "@seo-platform/contracts";
import { unzipSync } from "fflate";
import type { PrismaService } from "../database/prisma.service.js";
import {
  Prisma,
  type Job
} from "../generated/prisma/client.js";
import type { SeoDataClient } from "../seo-data/seo-data.client.js";
import type {
  CompletedPart,
  ObjectStoragePort
} from "../storage/object-storage.port.js";
import { semanticExportResult } from "./semantic-export-record.js";
import { SemanticExportWorkerService } from "./semantic-export-worker.service.js";

test("background worker exports all 2,002 rows and commits one artifact", async () => {
  let stored = queuedJob();
  const prisma = memoryPrisma(
    () => stored,
    (next) => {
      stored = next;
    }
  );
  const rows = Array.from({ length: 2_002 }, (_, index) => keyword(index + 1));
  const seoData = {
    listExportCustomColumns: async () => [],
    listExportKeywords: async (
      _context: unknown,
      query: { readonly cursor?: string; readonly limit: number }
    ) => {
      const offset = query.cursor ? Number(query.cursor.slice(7)) : 0;
      const data = rows.slice(offset, offset + query.limit);
      const next = offset + data.length;
      return {
        data,
        page: {
          hasNext: next < rows.length,
          ...(next < rows.length ? { nextCursor: `cursor-${next}` } : {}),
          totalApprox: rows.length
        },
        meta: { requestId: "test" }
      };
    }
  } as unknown as SeoDataClient;
  const storage = memoryStorage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = storage.fetch;
  try {
    const worker = new SemanticExportWorkerService(prisma, seoData, storage.port);
    const result = await worker.process(stored.id, worker.workerId());

    assert.deepEqual(result, {
      exportId: stored.id,
      outcome: "COMPLETED",
      rowCount: 2_002
    });
    assert.equal(stored.status, "COMPLETED");
    assert.equal(stored.progressCurrent, 2_002n);
    assert.equal(stored.progressTotal, 2_002n);
    assert.equal(
      (stored.resultSummary as { readonly rowCount: number }).rowCount,
      2_002
    );
    assert.equal(
      (stored.resultSummary as { readonly objectKey: string }).objectKey,
      `${stored.workspaceId}/${stored.projectId}/semantic-exports/${stored.id}/attempt-1.csv`
    );
    assert.equal(semanticExportResult(stored)?.rowCount, 2_002);
    assert.equal(
      semanticExportResult({
        ...stored,
        resultSummary: {
          ...(stored.resultSummary as Prisma.JsonObject),
          objectKey: `${stored.workspaceId}/another-project/secret.csv`
        }
      }),
      undefined
    );
    const artifact = storage.artifact();
    assert.equal(
      new TextDecoder().decode(artifact).trimEnd().split("\r\n").length,
      2_003
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("background worker builds the position history report in two bounded passes", async () => {
  let stored = {
    ...queuedJob(),
    inputSnapshot: {
      format: "XLSX",
      scope: "SELECTED",
      locale: "ru",
      columns: ["query"],
      filters: { isTracked: true },
      keywordIds: [
        "01900000-0000-7000-8000-000000000011",
        "01900000-0000-7000-8000-000000000012",
        "01900000-0000-7000-8000-000000000013"
      ],
      positionHistory: {
        observedFrom: "2026-08-01T00:00:00.000Z",
        observedBefore: "2026-08-20T00:00:00.000Z",
        searchEngines: ["YANDEX"]
      }
    }
  } as Job;
  const prisma = memoryPrisma(
    () => stored,
    (next) => { stored = next; }
  );
  let reads = 0;
  const historyRows: readonly SemanticPositionHistoryExportRow[] = [
    {
      keywordId: "01900000-0000-7000-8000-000000000011",
      text: "первый запрос",
      keywordLanguage: "ru",
      createdAt: "2026-07-01T00:00:00.000Z",
      snapshots: [
        { searchEngine: "YANDEX", observedDate: "2026-08-18", found: true, position: 4 }
      ]
    },
    {
      keywordId: "01900000-0000-7000-8000-000000000012",
      text: "второй запрос",
      keywordLanguage: "ru",
      createdAt: "2026-07-02T00:00:00.000Z",
      snapshots: [
        { searchEngine: "YANDEX", observedDate: "2026-08-18", found: false }
      ]
    }
  ];
  const seoData = {
    listExportRankDimensions: async () => ({
      dimensions: [{
        key: "YANDEX|RU|213|ru|DESKTOP",
        searchEngine: "YANDEX",
        countryCode: "RU",
        regionCode: "213",
        regionLabel: "Москва",
        language: "ru",
        device: "DESKTOP"
      }],
      truncated: false
    }),
    listExportCustomColumns: async () => {
      throw new Error("Position report must not load custom columns");
    },
    listExportPositionHistory: async (
      _context: unknown,
      query: Readonly<{ isTracked?: boolean }>
    ) => {
      reads += 1;
      assert.equal(query.isTracked, true);
      return {
        data: historyRows,
        page: { hasNext: false, totalApprox: historyRows.length },
        meta: { requestId: "test" }
      };
    }
  } as unknown as SeoDataClient;
  const storage = memoryStorage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = storage.fetch;
  try {
    const worker = new SemanticExportWorkerService(prisma, seoData, storage.port);
    const result = await worker.process(stored.id, worker.workerId());

    assert.equal(result.outcome, "COMPLETED");
    assert.equal(result.rowCount, 2);
    assert.equal(reads, 2);
    const archive = unzipSync(storage.artifact());
    const sheet = new TextDecoder().decode(archive["xl/worksheets/sheet1.xml"]);
    assert.match(sheet, /<t xml:space="preserve">первый запрос<\/t>/u);
    assert.match(sheet, /<f>COUNTIFS/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("background worker enriches each keyword row with competitor columns", async () => {
  let stored = {
    ...queuedJob(),
    inputSnapshot: {
      format: "CSV",
      scope: "CURRENT_FILTER",
      locale: "ru",
      columns: [
        "query",
        "serpCompetitorUrls",
        "serpCompetitorSerp",
        "aiCompetitorUrls"
      ]
    }
  } as Job;
  const prisma = memoryPrisma(
    () => stored,
    (next) => { stored = next; }
  );
  const keywordRows = [keyword(11), keyword(12)];
  const seoData = {
    listExportRankDimensions: async () => ({ dimensions: [], truncated: false }),
    listExportCustomColumns: async () => [],
    listExportKeywords: async () => ({
      data: keywordRows,
      page: { hasNext: false, totalApprox: keywordRows.length },
      meta: { requestId: "keywords" }
    }),
    listExportCompetitors: async (
      _context: unknown,
      query: { readonly limit: number },
      options: { readonly sources: readonly string[] }
    ) => {
      assert.equal(query.limit, 12);
      assert.equal(options.sources.length, 1);
      const serp = options.sources[0] === "SERP";
      return {
      data: [
        {
          keywordId: keywordRows[0]!.id,
          competitors: serp ? [
            {
              source: "SERP",
              url: "https://competitor.example/shared",
              normalizedUrl: "https://competitor.example/shared",
              title: "Первый",
              description: "Описание"
            }
          ] : [
            {
              source: "AI",
              url: "https://ai.example/source",
              normalizedUrl: "https://ai.example/source"
            }
          ]
        },
        {
          keywordId: keywordRows[1]!.id,
          competitors: serp ? [{
            source: "SERP",
            url: "https://competitor.example/shared",
            normalizedUrl: "https://competitor.example/shared",
            title: "Второй"
          }] : []
        }
      ],
      page: { hasNext: false, totalApprox: 2 },
      meta: { requestId: "test" }
      };
    }
  } as unknown as SeoDataClient;
  const storage = memoryStorage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = storage.fetch;
  try {
    const worker = new SemanticExportWorkerService(prisma, seoData, storage.port);
    const result = await worker.process(stored.id, worker.workerId());

    assert.equal(result.outcome, "COMPLETED");
    assert.equal(result.rowCount, 2);
    const csv = new TextDecoder().decode(storage.artifact());
    assert.match(csv, /^Запрос,Конкуренты,SERP конкурентов,ИИ-конкуренты\r\n/u);
    assert.equal(csv.match(/https:\/\/competitor\.example\/shared/gu)?.length, 4);
    assert.equal(csv.match(/https:\/\/ai\.example\/source/gu)?.length, 1);
    assert.match(csv, /Title: Первый\nDescription: Описание/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("background worker expands selected folder roots and exports direct memberships by sheet", async () => {
  const rootId = "01900000-0000-7000-8000-000000000020";
  const childId = "01900000-0000-7000-8000-000000000021";
  const emptyId = "01900000-0000-7000-8000-000000000022";
  let stored = {
    ...queuedJob(),
    inputSnapshot: {
      format: "XLSX",
      scope: "FOLDER_MAP",
      locale: "ru",
      columns: ["query", "priority"],
      sort: "TEXT_ASC",
      folderMap: {
        groupIds: [rootId],
        includeDescendants: true
      }
    }
  } as Job;
  const prisma = memoryPrisma(
    () => stored,
    (next) => { stored = next; }
  );
  const requestedGroupIds: string[] = [];
  const seoData = {
    listExportCustomColumns: async () => [],
    listExportKeywordGroups: async () => [
      group(rootId, "Каталог", 1, 0),
      group(childId, "Морозильные лари", 2, 0, rootId, "Каталог / Морозильные лари"),
      group(emptyId, "Пустая папка", 0, 1, rootId, "Каталог / Пустая папка"),
      group("01900000-0000-7000-8000-000000000023", "Не выбрана", 7, 2)
    ],
    listExportKeywords: async (
      _context: unknown,
      query: { readonly groupId?: string; readonly sort?: string }
    ) => {
      assert.ok(query.groupId);
      assert.equal(query.sort, "TEXT_ASC");
      requestedGroupIds.push(query.groupId);
      const data = query.groupId === rootId
        ? [keyword(31)]
        : query.groupId === childId
          ? [keyword(32), keyword(33)]
          : [];
      return {
        data,
        page: { hasNext: false, totalApprox: data.length },
        meta: { requestId: "folder-map" }
      };
    }
  } as unknown as SeoDataClient;
  const storage = memoryStorage();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = storage.fetch;
  try {
    const worker = new SemanticExportWorkerService(prisma, seoData, storage.port);
    const result = await worker.process(stored.id, worker.workerId());

    assert.deepEqual(result, {
      exportId: stored.id,
      outcome: "COMPLETED",
      rowCount: 3
    });
    assert.deepEqual(requestedGroupIds, [rootId, childId]);
    const archive = unzipSync(storage.artifact());
    const map = new TextDecoder().decode(archive["xl/worksheets/sheet1.xml"]);
    const rootSheet = new TextDecoder().decode(archive["xl/worksheets/sheet2.xml"]);
    const childSheet = new TextDecoder().decode(archive["xl/worksheets/sheet3.xml"]);
    assert.match(map, /Каталог/u);
    assert.match(map, /Морозильные лари/u);
    assert.match(map, /Пустая папка/u);
    assert.doesNotMatch(map, /Не выбрана/u);
    assert.match(rootSheet, /запрос 31/u);
    assert.match(childSheet, /запрос 32/u);
    assert.match(childSheet, /запрос 33/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function queuedJob(): Job {
  const now = new Date("2026-08-12T10:00:00.000Z");
  return {
    billingQuoteId: null, billingCommandHash: null, billingMaximumUnitsMilli: null,
    dismissedAt: null, dismissedBy: null,
    id: "01900000-0000-7000-8000-000000000010",
    workspaceId: "01900000-0000-7000-8000-000000000001",
    projectId: "01900000-0000-7000-8000-000000000002",
    actorId: "01900000-0000-7000-8000-000000000003",
    type: "SEMANTIC_EXPORT",
    status: "QUEUED",
    stage: "queued",
    priority: 100,
    scheduleId: null,
    parentJobId: null,
    deduplicationKey: null,
    idempotencyScope: "semantic-export:create:test",
    idempotencyKey: "semantic-export:test",
    requestHash: new Uint8Array(32),
    inputSnapshot: {
      format: "CSV",
      scope: "FULL_CORE",
      locale: "ru",
      columns: ["query"],
      includeBom: true
    },
    scopeSnapshot: {
      workspaceId: "01900000-0000-7000-8000-000000000001",
      projectId: "01900000-0000-7000-8000-000000000002"
    },
    progressCurrent: 0n,
    progressTotal: null,
    progressUnit: "rows",
    estimatedCostMicro: null,
    reservedCostMicro: null,
    actualCostMicro: null,
    currency: null,
    credentialMode: "PLATFORM_INCLUDED",
    provider: null,
    attempt: 0,
    maxAttempts: 5,
    errorSummary: null,
    resultSummary: null,
    correlationId: "semantic-export-test",
    version: 1,
    createdAt: now,
    queuedAt: now,
    startedAt: null,
    finishedAt: null,
    cancelRequestedAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    validationLeaseToken: null,
    retryAt: null,
    updatedAt: now
  };
}

function keyword(index: number): SemanticKeywordListItem {
  const suffix = String(index).padStart(12, "0");
  return {
    id: `01900000-0000-7000-8000-${suffix}`,
    textOriginal: `запрос ${index}`,
    textNormalized: `запрос ${index}`,
    language: "ru",
    priority: 50,
    isFavorite: false,
    isTracked: false,
    showAiAnswerButton: false,
    tags: [],
    tagsTruncated: false,
    sourceMode: "MANUAL",
    createdAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z",
    version: 1
  };
}

function group(
  id: string,
  name: string,
  keywordCount: number,
  position: number,
  parentId?: string,
  path = name
): Readonly<{
  id: string;
  parentId?: string;
  name: string;
  path: string;
  position: number;
  keywordCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}> {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    name,
    path,
    position,
    keywordCount,
    version: 1,
    createdAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z"
  };
}

function memoryPrisma(
  read: () => Job,
  write: (job: Job) => void
): PrismaService {
  const job = {
    findFirst: async ({ where }: { readonly where: Readonly<Record<string, unknown>> }) =>
      matches(read(), where) ? read() : null,
    findUnique: async ({ where }: { readonly where: Readonly<Record<string, unknown>> }) =>
      matches(read(), where) ? read() : null,
    updateMany: async ({
      where,
      data
    }: {
      readonly where: Readonly<Record<string, unknown>>;
      readonly data: Readonly<Record<string, unknown>>;
    }) => {
      const current = read();
      if (!matches(current, where)) return { count: 0 };
      write(applyJobUpdate(current, data));
      return { count: 1 };
    }
  };
  return { job } as unknown as PrismaService;
}

function matches(job: Job, where: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = job[key as keyof Job];
    return expected === undefined || actual === expected;
  });
}

function applyJobUpdate(
  job: Job,
  data: Readonly<Record<string, unknown>>
): Job {
  const next = { ...job } as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(data)) {
    if (
      typeof value === "object" &&
      value !== null &&
      "increment" in value
    ) {
      next[key] = Number(next[key]) + Number(value.increment);
    } else {
      next[key] = value === Prisma.DbNull ? null : value;
    }
  }
  next.updatedAt = new Date();
  return next as unknown as Job;
}

function memoryStorage(): {
  readonly port: ObjectStoragePort;
  readonly fetch: typeof globalThis.fetch;
  readonly artifact: () => Uint8Array;
} {
  const parts = new Map<string, Uint8Array>();
  let complete: Uint8Array<ArrayBufferLike> = new Uint8Array();
  const port = {
    isEnabled: () => true,
    createMultipartUpload: async (_bucket: string, objectKey: string) => ({
      uploadId: "upload-id",
      objectKey
    }),
    createUploadPartUrl: async (
      _bucket: string,
      _objectKey: string,
      _uploadId: string,
      partNumber: number
    ) => `https://storage.example.test/parts/${partNumber}`,
    completeMultipartUpload: async (
      _bucket: string,
      _objectKey: string,
      _uploadId: string,
      uploaded: readonly CompletedPart[]
    ) => {
      complete = concatenate(
        uploaded.map(({ etag }) => parts.get(etag) ?? new Uint8Array())
      );
    },
    abortMultipartUpload: async () => undefined,
    headObject: async () => ({ sizeBytes: BigInt(complete.byteLength) }),
    deleteObject: async () => {
      complete = new Uint8Array();
    }
  } as unknown as ObjectStoragePort;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const partNumber = new URL(String(input)).pathname.split("/").at(-1);
    const etag = `part-${partNumber}`;
    const body = init?.body;
    if (!(body instanceof Uint8Array)) throw new Error("Expected Uint8Array upload");
    parts.set(etag, new Uint8Array(body));
    return new Response(null, { status: 200, headers: { etag } });
  };
  return { port, fetch, artifact: () => complete };
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
