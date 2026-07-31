import assert from "node:assert/strict";
import test from "node:test";
import {
  HttpException,
  UnprocessableEntityException
} from "@nestjs/common";
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
  const transaction = {
    $executeRaw: async () => 1,
    upload: {
      findUnique: async () => null,
      aggregate: async () => ({ _sum: { sizeBytes: 0n } }),
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
  };
  const prisma = {
    upload: {
      findUnique: async () => null
    },
    $transaction: async (
      callback: (client: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
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
    sizeBytes: String(9 * 1_024 * 1_024),
    entitlement: storageEntitlement(20 * 1_024 * 1_024)
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

test("atomically rejects a new upload beyond plan storage and aborts its multipart", async () => {
  let aborted = 0;
  let created = false;
  const transaction = {
    $executeRaw: async () => 1,
    upload: {
      findUnique: async () => null,
      aggregate: async () => ({ _sum: { sizeBytes: 900n } }),
      create: async () => {
        created = true;
        return uploadRecord();
      }
    }
  };
  const prisma = {
    upload: {
      findUnique: async () => null
    },
    $transaction: async (
      callback: (client: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService;
  const service = new UploadService(
    prisma,
    storage({
      abortMultipartUpload: async () => {
        aborted += 1;
      }
    }),
    config(),
    queue()
  );

  await assert.rejects(
    service.create({
      workspaceId,
      projectId,
      actorId,
      idempotencyKey:
        "upload-01900000-0000-7000-8000-000000000006",
      fileName: "keywords.csv",
      mediaType: "text/csv",
      sizeBytes: "101",
      entitlement: storageEntitlement(1_000)
    }),
    (error: unknown) => {
      if (!(error instanceof HttpException)) return false;
      const response = error.getResponse() as {
        readonly error?: { readonly code?: string };
      };
      return response.error?.code === "QUOTA_EXCEEDED";
    }
  );
  assert.equal(created, false);
  assert.equal(aborted, 1);
});

test("returns an idempotent winner and removes the redundant multipart", async () => {
  let aborted = 0;
  const winner = uploadRecord();
  let lookups = 0;
  const transaction = {
    $executeRaw: async () => 1,
    upload: {
      findUnique: async () => winner,
      aggregate: async () => {
        throw new Error("capacity must not be recounted for a replay");
      },
      create: async () => {
        throw new Error("replay must not create another upload");
      }
    }
  };
  const prisma = {
    upload: {
      findUnique: async () => {
        lookups += 1;
        return lookups === 1 ? null : winner;
      }
    },
    $transaction: async (
      callback: (client: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService;
  const service = new UploadService(
    prisma,
    storage({
      abortMultipartUpload: async () => {
        aborted += 1;
      }
    }),
    config(),
    queue()
  );

  const result = await service.create({
    workspaceId,
    projectId,
    actorId,
    idempotencyKey: winner.idempotencyKey,
    fileName: winner.originalName,
    mediaType: "text/csv",
    sizeBytes: winner.sizeBytes.toString(),
    entitlement: storageEntitlement(1_000)
  });

  assert.equal(result.upload.id, winner.id);
  assert.equal(aborted, 1);
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
    crawl: {
      enabled: false,
      concurrency: 2,
      dispatchSeconds: 15,
      leaseSeconds: 180,
      requestTimeoutMs: 20_000,
      maxResponseBytes: 2_000_000,
      maxRedirects: 5,
      userAgent: "SeoPlatformCrawler/1.0 (+https://example.test/crawler)"
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

function storageEntitlement(storageBytes: number) {
  return {
    planCode: "TRIAL",
    planVersion: 1,
    storageBytes
  } as const;
}

async function* emptyStream(): AsyncGenerator<Uint8Array> {
  yield new Uint8Array();
}
