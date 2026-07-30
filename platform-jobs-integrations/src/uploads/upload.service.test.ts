import assert from "node:assert/strict";
import test from "node:test";
import { UnprocessableEntityException } from "@nestjs/common";
import type { Upload } from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { QueueService } from "../queue/queue.service.js";
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
  const service = new UploadService(
    prisma,
    storage(),
    config(),
    queue()
  );

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
  const service = new UploadService(
    prisma,
    objectStorage,
    config(),
    queue()
  );

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

test("returns a project-scoped inspection status without exposing scanner details", async () => {
  let lookup: unknown;
  const completedAt = new Date();
  const prisma = {
    upload: {
      findFirst: async ({ where }: { where: unknown }) => {
        lookup = where;
        return uploadRecord({
          status: "REJECTED",
          detectedMediaType: "application/octet-stream",
          scanResult: {
            status: "REJECTED",
            code: "MALWARE_DETECTED",
            malwareSignature: "Must.Not.Leak"
          },
          inspectionCompletedAt: completedAt
        });
      }
    }
  } as unknown as PrismaService;
  const service = new UploadService(prisma, storage(), config(), queue());

  const result = await service.get(
    "01900000-0000-7000-8000-000000000005",
    workspaceId,
    projectId
  );

  assert.deepEqual(lookup, {
    id: "01900000-0000-7000-8000-000000000005",
    workspaceId,
    projectId
  });
  assert.equal(result.status, "REJECTED");
  assert.equal(result.rejectionCode, "MALWARE_DETECTED");
  assert.equal(result.inspectionCompletedAt, completedAt.toISOString());
  assert.equal("malwareSignature" in result, false);
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
    detectedMediaType: null,
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
    inspectionStartedAt: null,
    inspectionHeartbeatAt: null,
    inspectionCompletedAt: null,
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
    getObjectStream: async () => emptyStream(),
    deleteObject: async () => undefined,
    ...overrides
  };
}

function config(): AppConfig {
  return {
    processRole: "HTTP",
    nodeEnv: "test",
    bindAddress: "127.0.0.1",
    port: 4002,
    version: "test",
    databaseUrl: "postgresql://unused",
    databasePoolMax: 1,
    redisUrl: "redis://unused",
    internalCommandTimeoutMs: 60_000,
    platformApiCommandTimeoutMs: 5_000,
    services: {
      seoData: "http://seo-data",
      platformApi: "http://platform-api"
    },
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
      secure: false,
      connectionTimeoutMs: 10_000,
      socketTimeoutMs: 60_000
    },
    malwareScanner: {
      enabled: false,
      port: 3310,
      connectTimeoutMs: 5_000,
      scanTimeoutMs: 900_000
    },
    integrationCredentials: {
      enabled: false,
      role: "DISABLED",
      keys: new Map(),
      fingerprintKeys: new Map()
    },
    integrationCredentialValidation: {
      timeoutMs: 10_000,
      leaseSeconds: 120,
      dispatchSeconds: 15,
      concurrency: 2
    },
    rankPreparation: {
      enabled: false,
      leaseSeconds: 120,
      dispatchSeconds: 15,
      concurrency: 2
    },
    rankExecution: {
      submitEnabled: false,
      killSwitchVersion: "arsenkin-positions@1"
    },
    authEmail: disabledAuthEmailConfig(),
    uploads: {
      maxSizeBytes: 5 * 1_024 * 1_024 * 1_024,
      partSizeBytes: 8 * 1_024 * 1_024,
      expiresHours: 24,
      inspectionLeaseMinutes: 30,
      inspectionDispatchSeconds: 30,
      inspectionHeartbeatSeconds: 60,
      inspectionConcurrency: 2
    },
    imports: {
      parseLeaseMinutes: 30,
      parseDispatchSeconds: 30,
      parseHeartbeatSeconds: 30,
      parseConcurrency: 2,
      stagingBatchRows: 1_000,
      previewRows: 20,
      publishBatchRows: 200
    }
  };
}

function disabledAuthEmailConfig(): AppConfig["authEmail"] {
  return {
    enabled: false,
    streamName: "AUTH_EMAIL_EVENTS",
    durableName: "jobs_auth_email_v1",
    deadLetterStreamName: "DOMAIN_EVENTS_DLQ",
    maxAttempts: 6,
    leaseSeconds: 120,
    dispatchMs: 1_000,
    fetchExpiresMs: 1_000,
    publishTimeoutMs: 5_000,
    retryBaseMs: 5_000,
    retryMaxMs: 21_600_000,
    maxPayloadBytes: 65_536,
    shutdownGraceMs: 10_000
  };
}

function queue(): QueueService {
  return {
    enqueueUploadInspection: async () => undefined
  } as unknown as QueueService;
}

async function* emptyStream(): AsyncGenerator<Uint8Array> {
  yield new Uint8Array();
}
