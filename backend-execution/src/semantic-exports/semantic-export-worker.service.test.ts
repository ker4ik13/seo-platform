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
      scope: "FULL_CORE",
      locale: "ru",
      columns: ["query"],
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
      createdAt: "2026-07-01T00:00:00.000Z",
      snapshots: [
        { searchEngine: "YANDEX", observedDate: "2026-08-18", found: true, position: 4 }
      ]
    },
    {
      keywordId: "01900000-0000-7000-8000-000000000012",
      text: "второй запрос",
      createdAt: "2026-07-02T00:00:00.000Z",
      snapshots: [
        { searchEngine: "YANDEX", observedDate: "2026-08-18", found: false }
      ]
    }
  ];
  const seoData = {
    listExportCustomColumns: async () => {
      throw new Error("Position report must not load custom columns");
    },
    listExportPositionHistory: async () => {
      reads += 1;
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

function queuedJob(): Job {
  const now = new Date("2026-08-12T10:00:00.000Z");
  return {
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
    tags: [],
    tagsTruncated: false,
    sourceMode: "MANUAL",
    createdAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z",
    version: 1
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
