import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { Upload } from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type {
  MalwareScannerPort,
  MalwareScanResult
} from "../malware/malware-scanner.port.js";
import type { ObjectStoragePort } from "../storage/object-storage.port.js";
import { UploadInspectionService } from "./upload-inspection.service.js";

const content = Buffer.from("keyword,group\nseo,main\n", "utf8");

test("streams a clean upload to READY with a server checksum", async () => {
  const updates: Array<Readonly<Record<string, unknown>>> = [];
  const events: unknown[] = [];
  const prisma = prismaFixture(updates, events);
  const service = new UploadInspectionService(
    prisma,
    storageFixture(content),
    malwareFixture(true),
    configFixture()
  );

  const result = await service.inspect(uploadRecord().id);

  assert.deepEqual(result, {
    uploadId: uploadRecord().id,
    status: "READY"
  });
  assert.equal(updates.at(-1)?.status, "READY");
  assert.equal(
    updates.at(-1)?.checksum,
    createHash("sha256").update(content).digest("hex")
  );
  assert.equal(updates.at(-1)?.detectedMediaType, "text/csv");
  assert.equal(events.length, 1);
});

test("never marks an upload ready when malware scanning is disabled", async () => {
  const updates: Array<Readonly<Record<string, unknown>>> = [];
  const service = new UploadInspectionService(
    prismaFixture(updates, []),
    storageFixture(content),
    malwareFixture(false),
    configFixture()
  );

  await assert.rejects(
    service.inspect(uploadRecord().id),
    /Malware scanner is disabled/u
  );
  assert.equal(updates.at(-1)?.status, "UPLOADED");
  assert.equal(updates.at(-1)?.inspectionStartedAt, null);
});

test("rejects infected content before any parser can consume it", async () => {
  const updates: Array<Readonly<Record<string, unknown>>> = [];
  const events: unknown[] = [];
  const service = new UploadInspectionService(
    prismaFixture(updates, events),
    storageFixture(content),
    malwareFixture(true, {
      status: "INFECTED",
      engine: "clamd",
      signature: "Test.Signature"
    }),
    configFixture()
  );

  const result = await service.inspect(uploadRecord().id);

  assert.deepEqual(result, {
    uploadId: uploadRecord().id,
    status: "REJECTED",
    code: "MALWARE_DETECTED"
  });
  assert.equal(updates.at(-1)?.status, "REJECTED");
  assert.deepEqual(updates.at(-1)?.scanResult, {
    status: "REJECTED",
    code: "MALWARE_DETECTED",
    engine: "clamd",
    malwareSignature: "Test.Signature",
    checksumAlgorithm: "SHA-256",
    inspectedSizeBytes: content.length.toString()
  });
  assert.equal(events.length, 1);
});

function prismaFixture(
  updates: Array<Readonly<Record<string, unknown>>>,
  events: unknown[]
): PrismaService {
  const upload = uploadRecord();
  const delegate = {
    updateMany: async ({
      data
    }: {
      data: Readonly<Record<string, unknown>>;
    }) => {
      updates.push(data);
      return { count: 1 };
    },
    findUnique: async () => upload,
    findMany: async () => []
  };
  const transaction = {
    upload: delegate,
    outboxEvent: {
      create: async ({ data }: { data: unknown }) => {
        events.push(data);
        return data;
      }
    }
  };
  return {
    upload: delegate,
    $transaction: async (
      callback: (value: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService;
}

function storageFixture(value: Uint8Array): ObjectStoragePort {
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
    headObject: async () => ({ sizeBytes: BigInt(value.length) }),
    getObjectStream: async () => chunks(value),
    deleteObject: async () => undefined
  };
}

function malwareFixture(
  enabled: boolean,
  result: MalwareScanResult = { status: "CLEAN", engine: "clamd" }
): MalwareScannerPort {
  return {
    isEnabled: () => enabled,
    healthCheck: async () => undefined,
    scan: async (
      source: AsyncIterable<Uint8Array>
    ): Promise<MalwareScanResult> => {
      for await (const chunk of source) void chunk;
      return result;
    }
  };
}

function uploadRecord(): Upload {
  const now = new Date();
  return {
    id: "01900000-0000-7000-8000-000000000005",
    workspaceId: "01900000-0000-7000-8000-000000000001",
    projectId: "01900000-0000-7000-8000-000000000002",
    actorId: "01900000-0000-7000-8000-000000000003",
    status: "UPLOADED",
    bucket: "uploads",
    objectKey: "workspace/project/opaque.csv",
    originalName: "keywords.csv",
    mediaType: "text/csv",
    detectedMediaType: null,
    sizeBytes: BigInt(content.length),
    declaredChecksum: null,
    checksum: null,
    multipartId: "multipart-1",
    partSizeBytes: 8 * 1_024 * 1_024,
    partCount: 1,
    idempotencyKey: "upload-01900000-0000-7000-8000-000000000004",
    scanResult: null,
    expiresAt: new Date(now.getTime() + 60_000),
    uploadedAt: now,
    abortedAt: null,
    inspectionStartedAt: null,
    inspectionHeartbeatAt: null,
    inspectionCompletedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}

function configFixture(): AppConfig {
  return {
    processRole: "INSPECTION_WORKER",
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
    email: { enabled: false, port: 587, secure: false },
    malwareScanner: {
      enabled: true,
      host: "clamav",
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

async function* chunks(value: Uint8Array): AsyncGenerator<Uint8Array> {
  const middle = Math.ceil(value.length / 2);
  yield value.subarray(0, middle);
  yield value.subarray(middle);
}
