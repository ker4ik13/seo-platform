import assert from "node:assert/strict";
import test from "node:test";
import type {
  SemanticImport,
  Upload
} from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { ObjectStoragePort } from "../storage/object-storage.port.js";
import { SemanticImportParserService } from "./semantic-import-parser.service.js";

const importId = "01900000-0000-7000-8000-000000000010";
const uploadId = "01900000-0000-7000-8000-000000000005";
const content = Buffer.from(
  "Фраза;Группа;Точная частотность;Мой балл\r\nseo;main;10;5\r\nsite;other;20;7\r\n",
  "utf8"
);

test("streams a Key Collector CSV into staging and mapping preview", async () => {
  const updates: Array<Readonly<Record<string, unknown>>> = [];
  const staged: unknown[] = [];
  const events: unknown[] = [];
  const parser = new SemanticImportParserService(
    prismaFixture(updates, staged, events),
    storageFixture(content),
    configFixture()
  );

  const result = await parser.parse(importId);

  assert.deepEqual(result, {
    importId,
    status: "AWAITING_MAPPING"
  });
  assert.equal(staged.length, 2);
  const update = updates.at(-1);
  assert.ok(update);
  assert.equal(update.status, "AWAITING_MAPPING");
  assert.deepEqual(update.headers, [
    "Фраза",
    "Группа",
    "Точная частотность",
    "Мой балл"
  ]);
  assert.deepEqual(
    (
      update.suggestedMapping as readonly {
        suggestedTarget: string;
      }[]
    ).map(({ suggestedTarget }) => suggestedTarget),
    ["keyword.text", "group.path", "frequency.exact", "custom"]
  );
  assert.equal(update.totalRows, 2n);
  assert.equal(update.validRows, 2n);
  assert.equal(update.warningRows, 0n);
  assert.equal(events.length, 1);
});

test("marks a malformed CSV as FAILED without retrying dependencies", async () => {
  const updates: Array<Readonly<Record<string, unknown>>> = [];
  const parser = new SemanticImportParserService(
    prismaFixture(updates, [], []),
    storageFixture(Buffer.from("Фраза;Группа\n\"seo;main\n", "utf8")),
    configFixture()
  );

  const result = await parser.parse(importId);

  assert.deepEqual(result, {
    importId,
    status: "FAILED",
    code: "UNTERMINATED_QUOTE"
  });
  assert.equal(updates.at(-1)?.status, "FAILED");
  assert.deepEqual(updates.at(-1)?.failure, {
    code: "UNTERMINATED_QUOTE"
  });
});

function prismaFixture(
  updates: Array<Readonly<Record<string, unknown>>>,
  staged: unknown[],
  events: unknown[]
): PrismaService {
  const semanticImport = importRecord();
  const semanticImportDelegate = {
    updateMany: async ({
      data
    }: {
      data: Readonly<Record<string, unknown>>;
    }) => {
      updates.push(data);
      return { count: 1 };
    },
    findUnique: async () => semanticImport,
    findMany: async () => []
  };
  const uploadDelegate = {
    findFirst: async () => uploadRecord()
  };
  const stagingDelegate = {
    deleteMany: async () => ({ count: 0 }),
    createMany: async ({ data }: { data: readonly unknown[] }) => {
      staged.push(...data);
      return { count: data.length };
    }
  };
  const transaction = {
    semanticImport: semanticImportDelegate,
    outboxEvent: {
      create: async ({ data }: { data: unknown }) => {
        events.push(data);
        return data;
      }
    }
  };
  return {
    semanticImport: semanticImportDelegate,
    semanticImportStagingRow: stagingDelegate,
    upload: uploadDelegate,
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
    getObjectStream: async () => byteChunks(value),
    deleteObject: async () => undefined
  };
}

function importRecord(): SemanticImport {
  const now = new Date();
  return {
    id: importId,
    workspaceId: "01900000-0000-7000-8000-000000000001",
    projectId: "01900000-0000-7000-8000-000000000002",
    uploadId,
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
    billingPlanCode: null,
    billingPlanVersion: null,
    storedKeywordsLimit: null,
    keywordsPerProjectLimit: null,
    trackedContextPairsLimit: null,
    totalRows: 0n,
    validRows: 0n,
    warningRows: 0n,
    errorRows: 0n,
    progressBytes: 0n,
    totalBytes: BigInt(content.length),
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
  const now = new Date();
  return {
    id: uploadId,
    workspaceId: "01900000-0000-7000-8000-000000000001",
    projectId: "01900000-0000-7000-8000-000000000002",
    actorId: "01900000-0000-7000-8000-000000000003",
    status: "READY",
    bucket: "uploads",
    objectKey: "workspace/project/opaque.csv",
    originalName: "keywords.csv",
    mediaType: "text/csv",
    detectedMediaType: "text/csv",
    sizeBytes: BigInt(content.length),
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

function configFixture(): AppConfig {
  return {
    processRole: "IMPORT_WORKER",
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

async function* byteChunks(value: Uint8Array): AsyncGenerator<Uint8Array> {
  const third = Math.ceil(value.byteLength / 3);
  for (let offset = 0; offset < value.byteLength; offset += third) {
    yield value.subarray(offset, Math.min(value.byteLength, offset + third));
  }
}
