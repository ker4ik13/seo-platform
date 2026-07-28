import assert from "node:assert/strict";
import test from "node:test";
import type {
  SemanticImport,
  Upload
} from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { QueueService } from "../queue/queue.service.js";
import { SemanticImportService } from "./semantic-import.service.js";

test("creates an idempotent import only from a READY project upload", async () => {
  const events: unknown[] = [];
  const enqueued: string[] = [];
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
        semanticImport: {
          create: async () => semanticImport
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
      actorId: semanticImport.actorId,
      uploadId: semanticImport.uploadId,
      idempotencyKey: semanticImport.idempotencyKey,
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
});

function importRecord(): SemanticImport {
  const now = new Date();
  return {
    id: "01900000-0000-7000-8000-000000000010",
    workspaceId: "01900000-0000-7000-8000-000000000001",
    projectId: "01900000-0000-7000-8000-000000000002",
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
    suggestedMapping: null,
    sampleRows: null,
    confirmedMapping: null,
    validationSummary: null,
    resultSummary: null,
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
