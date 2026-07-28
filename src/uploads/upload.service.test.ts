import assert from "node:assert/strict";
import test from "node:test";
import { UnprocessableEntityException } from "@nestjs/common";
import type { Upload } from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { ObjectStoragePort } from "../storage/object-storage.port.js";
import { UploadService } from "./upload.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";

test("creates an opaque, idempotent multipart declaration", async () => {
  let createData: Readonly<Record<string, unknown>> | undefined;
  const prisma = {
    upload: {
      findUnique: async () => null,
      create: async ({ data }: { data: Readonly<Record<string, unknown>> }) => {
        createData = data;
        return uploadRecord({
          objectKey: String(data.objectKey),
          sizeBytes: data.sizeBytes as bigint,
          partSizeBytes: Number(data.partSizeBytes),
          partCount: Number(data.partCount)
        });
      }
    }
  } as unknown as PrismaService;
  const service = new UploadService(prisma, storage(), config());

  const result = await service.create({
    workspaceId,
    projectId,
    actorId,
    idempotencyKey: "upload-01900000-0000-7000-8000-000000000004",
    fileName: "client-keywords.csv",
    mediaType: "text/csv",
    sizeBytes: String(9 * 1_024 * 1_024)
  });

  assert.equal(result.partSizeBytes, 8 * 1_024 * 1_024);
  assert.equal(result.partCount, 2);
  assert.equal(createData?.declaredChecksum, undefined);
  assert.match(
    String(createData?.objectKey),
    new RegExp(`^${workspaceId}/${projectId}/`)
  );
  assert.equal(String(createData?.objectKey).includes("client-keywords"), false);
});

test("requires every part and scopes lookup to actor and tenant", async () => {
  let lookup: unknown;
  let completed = false;
  const prisma = {
    upload: {
      findFirst: async ({ where }: { where: unknown }) => {
        lookup = where;
        return uploadRecord({ partCount: 2 });
      }
    }
  } as unknown as PrismaService;
  const objectStorage = storage({
    completeMultipartUpload: async () => {
      completed = true;
    }
  });
  const service = new UploadService(prisma, objectStorage, config());

  await assert.rejects(
    service.complete(
      "01900000-0000-7000-8000-000000000005",
      workspaceId,
      projectId,
      actorId,
      {
        parts: [
          {
            partNumber: 1,
            etag: "\"d41d8cd98f00b204e9800998ecf8427e\""
          }
        ]
      },
      "request-1"
    ),
    UnprocessableEntityException
  );
  assert.deepEqual(lookup, {
    id: "01900000-0000-7000-8000-000000000005",
    workspaceId,
    projectId,
    actorId
  });
  assert.equal(completed, false);
});

function uploadRecord(overrides: Partial<Upload> = {}): Upload {
  const now = new Date();
  return {
    id: "01900000-0000-7000-8000-000000000005",
    workspaceId,
    projectId,
    actorId,
    status: "INITIATED",
    bucket: "uploads",
    objectKey: `${workspaceId}/${projectId}/opaque.csv`,
    originalName: "keywords.csv",
    mediaType: "text/csv",
    sizeBytes: 1_024n,
    declaredChecksum: null,
    checksum: null,
    multipartId: "multipart-1",
    partSizeBytes: 8 * 1_024 * 1_024,
    partCount: 1,
    idempotencyKey: "upload-01900000-0000-7000-8000-000000000004",
    scanResult: null,
    expiresAt: new Date(now.getTime() + 60_000),
    uploadedAt: null,
    abortedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function storage(
  overrides: Partial<ObjectStoragePort> = {}
): ObjectStoragePort {
  return {
    isEnabled: () => true,
    healthCheck: async () => undefined,
    createMultipartUpload: async (_bucket, objectKey) => ({
      uploadId: "multipart-1",
      objectKey
    }),
    createUploadPartUrl: async () => "https://storage.invalid/signed",
    completeMultipartUpload: async () => undefined,
    abortMultipartUpload: async () => undefined,
    createDownloadUrl: async () => "https://storage.invalid/download",
    headObject: async () => ({ sizeBytes: 1_024n }),
    deleteObject: async () => undefined,
    ...overrides
  };
}

function config(): AppConfig {
  return {
    nodeEnv: "test",
    port: 4002,
    version: "test",
    databaseUrl: "postgresql://unused",
    databasePoolMax: 1,
    redisUrl: "redis://unused",
    nats: { url: "nats://unused" },
    s3: {
      enabled: true,
      region: "test",
      forcePathStyle: false,
      signedUrlTtlSeconds: 900,
      buckets: { uploads: "uploads", artifacts: "artifacts" }
    },
    email: {
      enabled: false,
      port: 587,
      secure: false
    },
    uploads: {
      maxSizeBytes: 5 * 1_024 * 1_024 * 1_024,
      partSizeBytes: 8 * 1_024 * 1_024,
      expiresHours: 24
    }
  };
}
