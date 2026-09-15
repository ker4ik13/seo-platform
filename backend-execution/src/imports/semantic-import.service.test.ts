import assert from "node:assert/strict";
import test from "node:test";
import type {
  SemanticImport,
  Upload
} from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { QueueService } from "../queue/queue.service.js";
import {
  encodeSemanticImportPreviewCursor,
  safeMapping,
  safeValidation,
  semanticImportPreviewCursor,
  SemanticImportService
} from "./semantic-import.service.js";

test("keeps legacy import mappings resumable and reads new skip counters", () => {
  const legacy = safeMapping({
    columns: [{ sourceIndex: 0, target: "keyword.text" }],
    defaultLanguage: "ru",
    groupSeparator: "/",
    duplicatePolicy: "OVERWRITE_MAPPED"
  });
  assert.equal(legacy?.createMissingKeywords, true);
  assert.equal(
    safeMapping({ ...legacy, createMissingKeywords: false })
      ?.createMissingKeywords,
    false
  );
  assert.equal(
    safeMapping({ ...legacy, createMissingKeywords: "false" }),
    undefined
  );

  const validation = safeValidation({
    totalRows: "2",
    validRows: "2",
    warningRows: "0",
    errorRows: "0",
    duplicateRowsInFile: "0",
    existingKeywordsInProject: "1",
    uniqueKeywordsToProcess: "1",
    issueCounts: {}
  });
  assert.equal(validation?.newKeywordsSkipped, "0");
  assert.equal(
    safeValidation({
      ...validation,
      newKeywordsSkipped: 0
    }),
    undefined
  );
});

test("creates an idempotent import only from a READY project upload", async () => {
  const events: unknown[] = [];
  const enqueued: string[] = [];
  let createdData: Readonly<Record<string, unknown>> | undefined;
  const semanticImport = importRecord();
  const prisma = {
    upload: {
      findFirst: async () => uploadRecord()
    },
    semanticImport: {
      findUnique: async () => null
    },
    $transaction: async (
      callback: (value: unknown) => Promise<unknown>
    ) =>
      callback({
        $executeRaw: async () => 1,
        job: { count: async () => 0 },
        semanticImport: {
          count: async () => 0,
          create: async ({ data }: { data: Readonly<Record<string, unknown>> }) => {
            createdData = data;
            return semanticImport;
          }
        },
        outboxEvent: {
          create: async ({ data }: { data: unknown }) => {
            events.push(data);
            return data;
          }
        }
      })
  } as unknown as PrismaService;
  const queue = {
    enqueueSemanticImport: async (value: string) => {
      enqueued.push(value);
    }
  } as unknown as QueueService;
  const service = new SemanticImportService(prisma, queue);

  const result = await service.create(
    {
      workspaceId: semanticImport.workspaceId,
      projectId: semanticImport.projectId,
      projectDomain: "example.com",
      actorId: semanticImport.actorId,
      uploadId: semanticImport.uploadId,
      idempotencyKey: semanticImport.idempotencyKey,
      jobCapacity: {
        planCode: "TRIAL",
        planVersion: 1,
        concurrentJobs: 1
      },
      semanticCapacity: {
        planCode: "TRIAL",
        planVersion: 1,
        storedKeywords: 100_000,
        keywordsPerProject: 50_000,
        foldersPerProject: 5_000,
        trackedContextPairs: 10_000
      },
      parse: {
        encoding: "AUTO",
        delimiter: "AUTO",
        headerMode: "AUTO"
      }
    },
    "request-1"
  );

  assert.equal(result.status, "QUEUED");
  assert.deepEqual(enqueued, [semanticImport.id]);
  assert.equal(events.length, 1);
  assert.equal(createdData?.billingPlanCode, "TRIAL");
  assert.equal(createdData?.storedKeywordsLimit, 100_000n);
  assert.equal(createdData?.foldersPerProjectLimit, 5_000n);
});

test("pages semantic import preview rows in fixed batches of 100", async () => {
  const semanticImport = {
    ...importRecord(),
    status: "AWAITING_MAPPING" as const,
    headers: ["Phrase", "Frequency"],
    suggestedMapping: [
      { index: 0, sourceName: "Phrase", suggestedTarget: "keyword.text", confidence: 0.99 },
      { index: 1, sourceName: "Frequency", suggestedTarget: "frequency.base", confidence: 0.9 }
    ],
    totalRows: 101n
  };
  const batches = [
    Array.from({ length: 101 }, (_, index) => ({
      row_number: BigInt(index + 1),
      raw_values: [`phrase ${index + 1}`, String(index + 1)]
    })),
    [{ row_number: 101n, raw_values: ["phrase 101", "101"] }]
  ];
  const prisma = {
    semanticImport: { findFirst: async () => semanticImport },
    $queryRaw: async () => batches.shift() ?? []
  } as unknown as PrismaService;
  const service = new SemanticImportService(
    prisma,
    {} as QueueService
  );

  const first = await service.previewRows(
    semanticImport.id,
    semanticImport.workspaceId,
    semanticImport.projectId,
    {}
  );
  assert.equal(first.rows.length, 100);
  assert.equal(first.rows[0]?.rowNumber, "1");
  assert.equal(first.page.hasNext, true);
  assert.ok(first.page.nextCursor);

  const second = await service.previewRows(
    semanticImport.id,
    semanticImport.workspaceId,
    semanticImport.projectId,
    { cursor: first.page.nextCursor }
  );
  assert.deepEqual(second.rows, [{
    rowNumber: "101",
    values: ["phrase 101", "101"]
  }]);
  assert.equal(second.page.hasNext, false);
  assert.equal(second.page.totalRows, "101");
});

test("binds semantic import preview cursors to the requested sorting", () => {
  const cursor = encodeSemanticImportPreviewCursor({
    offset: 100,
    sortColumn: 1,
    sortDirection: "DESC"
  });
  assert.deepEqual(
    semanticImportPreviewCursor(cursor, {
      sortColumn: 1,
      sortDirection: "DESC"
    }),
    { offset: 100, sortColumn: 1, sortDirection: "DESC" }
  );
  assert.throws(() => semanticImportPreviewCursor(cursor, {
    sortColumn: 1,
    sortDirection: "ASC"
  }));
});

function importRecord(): SemanticImport {
  const now = new Date();
  return {
    id: "01900000-0000-7000-8000-000000000010",
    workspaceId: "01900000-0000-7000-8000-000000000001",
    projectId: "01900000-0000-7000-8000-000000000002",
    projectDomain: "example.com",
    uploadId: "01900000-0000-7000-8000-000000000005",
    actorId: "01900000-0000-7000-8000-000000000003",
    status: "QUEUED",
    stage: "queued",
    sourceFormat: "CSV",
    requestedEncoding: "AUTO",
    requestedDelimiter: "AUTO",
    headerMode: "AUTO",
    detectedEncoding: null,
    detectedDelimiter: null,
    headers: null,
    sourceMetadata: null,
    suggestedMapping: null,
    sampleRows: null,
    confirmedMapping: null,
    validationSummary: null,
    resultSummary: null,
    billingPlanCode: null,
    billingPlanVersion: null,
    storedKeywordsLimit: null,
    keywordsPerProjectLimit: null,
    foldersPerProjectLimit: null,
    trackedContextPairsLimit: null,
    totalRows: 0n,
    validRows: 0n,
    warningRows: 0n,
    errorRows: 0n,
    progressBytes: 0n,
    totalBytes: 100n,
    failure: null,
    idempotencyKey: "semantic-import-test-1",
    parsingStartedAt: null,
    parsingHeartbeatAt: null,
    parsingCompletedAt: null,
    validationStartedAt: null,
    validationHeartbeatAt: null,
    validationCompletedAt: null,
    publishingStartedAt: null,
    publishingHeartbeatAt: null,
    publishingCompletedAt: null,
    publishingAttempts: 0,
    cancelRequestedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}

function uploadRecord(): Upload {
  const semanticImport = importRecord();
  const now = new Date();
  return {
    id: semanticImport.uploadId,
    workspaceId: semanticImport.workspaceId,
    projectId: semanticImport.projectId,
    actorId: semanticImport.actorId,
    status: "READY",
    bucket: "uploads",
    objectKey: "workspace/project/opaque.csv",
    originalName: "keywords.csv",
    mediaType: "text/csv",
    detectedMediaType: "text/csv",
    sizeBytes: 100n,
    declaredChecksum: null,
    checksum: "a".repeat(64),
    multipartId: "multipart-1",
    partSizeBytes: 8 * 1_024 * 1_024,
    partCount: 1,
    idempotencyKey: "upload-test-1",
    scanResult: { status: "CLEAN" },
    expiresAt: new Date(now.getTime() + 60_000),
    uploadedAt: now,
    abortedAt: null,
    inspectionStartedAt: now,
    inspectionHeartbeatAt: now,
    inspectionCompletedAt: now,
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}
