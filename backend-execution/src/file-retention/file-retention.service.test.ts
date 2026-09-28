import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { Job, Upload } from "../generated/prisma/client.js";
import { semanticExportSummary } from "../semantic-exports/semantic-export-record.js";
import type { ObjectStoragePort } from "../storage/object-storage.port.js";
import { FileRetentionService } from "./file-retention.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const uploadId = "01900000-0000-7000-8000-000000000003";
const exportId = "01900000-0000-7000-8000-000000000004";
const now = new Date("2026-09-28T12:00:00.000Z");
const old = new Date("2026-08-01T12:00:00.000Z");

test("removes old uploaded and exported objects while preserving their audit rows", async () => {
  const fixture = memoryFixture();
  await fixture.service.sweep(now);

  assert.deepEqual(fixture.deleted, [
    `uploads:${workspaceId}/${projectId}/upload.csv`,
    `artifacts:${workspaceId}/${projectId}/semantic-exports/${exportId}/attempt-1.csv`
  ]);
  assert.equal(fixture.upload().status, "EXPIRED");
  assert.ok(fixture.upload().objectDeletedAt);
  assert.equal(fixture.job().stage, "expired");
  assert.equal(semanticExportSummary(fixture.job()).status, "EXPIRED");
});

test("does not remove an upload needed by an unfinished import", async () => {
  const fixture = memoryFixture({ activeImports: 1 });
  await fixture.service.sweep(now);
  assert.equal(fixture.upload().status, "READY");
  assert.equal(fixture.upload().objectDeletedAt, null);
  assert.equal(fixture.deleted.some((item) => item.startsWith("uploads:")), false);
});

test("retries an S3 failure without declaring the object deleted", async () => {
  const fixture = memoryFixture({ failUploadDeleteOnce: true });
  await fixture.service.sweep(now);
  assert.equal(fixture.upload().status, "EXPIRED");
  assert.equal(fixture.upload().objectDeletedAt, null);
  await fixture.service.sweep(now);
  assert.ok(fixture.upload().objectDeletedAt);
  assert.equal(fixture.deleted.filter((item) => item.startsWith("uploads:")).length, 1);
});

test("retries aborting an incomplete multipart upload before marking it deleted", async () => {
  const fixture = memoryFixture({ incompleteUpload: true, failAbortOnce: true });
  await fixture.service.sweep(now);
  assert.equal(fixture.upload().status, "EXPIRED");
  assert.equal(fixture.upload().objectDeletedAt, null);
  await fixture.service.sweep(now);
  assert.ok(fixture.upload().objectDeletedAt);
  assert.equal(fixture.aborted.length, 1);
});

function memoryFixture(options: {
  readonly activeImports?: number;
  readonly failUploadDeleteOnce?: boolean;
  readonly incompleteUpload?: boolean;
  readonly failAbortOnce?: boolean;
} = {}): {
  readonly service: FileRetentionService;
  readonly upload: () => Upload;
  readonly job: () => Job;
  readonly deleted: string[];
  readonly aborted: string[];
} {
  let upload = {
    id: uploadId,
    workspaceId,
    projectId,
    bucket: "uploads",
    objectKey: `${workspaceId}/${projectId}/upload.csv`,
    status: options.incompleteUpload ? "INITIATED" : "READY",
    multipartId: "multipart-1",
    createdAt: old,
    uploadedAt: options.incompleteUpload ? null : old,
    objectDeletedAt: null,
    version: 1
  } as unknown as Upload;
  let job = {
    id: exportId,
    workspaceId,
    projectId,
    type: "SEMANTIC_EXPORT",
    status: "COMPLETED",
    stage: "completed",
    attempt: 1,
    progressCurrent: 2n,
    progressTotal: 2n,
    inputSnapshot: { format: "CSV", scope: "FULL_CORE" },
    resultSummary: {
      objectKey: `${workspaceId}/${projectId}/semantic-exports/${exportId}/attempt-1.csv`,
      filename: "export.csv",
      contentType: "text/csv; charset=utf-8",
      rowCount: 2,
      sizeBytes: "100"
    },
    finishedAt: old,
    createdAt: old,
    updatedAt: old,
    version: 1
  } as unknown as Job;
  const deleted: string[] = [];
  const aborted: string[] = [];
  let failUploadDelete = options.failUploadDeleteOnce ?? false;
  let failAbort = options.failAbortOnce ?? false;
  const storage = {
    isEnabled: () => true,
    abortMultipartUpload: async (_bucket: string, key: string) => {
      if (failAbort) {
        failAbort = false;
        throw new Error("S3 unavailable");
      }
      aborted.push(key);
    },
    deleteObject: async (bucket: string, key: string) => {
      if (bucket === "uploads" && failUploadDelete) {
        failUploadDelete = false;
        throw new Error("S3 unavailable");
      }
      deleted.push(`${bucket}:${key}`);
    }
  } as unknown as ObjectStoragePort;
  const transaction = {
    $queryRaw: async () => upload.objectDeletedAt ? [] : [{
      status: upload.status,
      multipart_id: upload.multipartId
    }],
    semanticImport: { count: async () => options.activeImports ?? 0 },
    upload: {
      update: async ({ data }: { data: { status: Upload["status"] } }) => {
        upload = { ...upload, status: data.status, version: upload.version + 1 };
        return upload;
      }
    }
  };
  const prisma = {
    $transaction: async (callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction),
    upload: {
      findMany: async () => upload.objectDeletedAt ? [] : [upload],
      updateMany: async () => {
        upload = { ...upload, objectDeletedAt: now, version: upload.version + 1 };
        return { count: 1 };
      }
    },
    job: {
      findMany: async () => job.stage === "completed" ? [job] : [],
      updateMany: async () => {
        job = { ...job, stage: "expired", version: job.version + 1 };
        return { count: 1 };
      }
    }
  } as unknown as PrismaService;
  const config = {
    fileRetention: { uploadDays: 30, exportDays: 7 }
  } as AppConfig;
  return {
    service: new FileRetentionService(prisma, storage, config),
    upload: () => upload,
    job: () => job,
    deleted,
    aborted
  };
}
