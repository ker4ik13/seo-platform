import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import type {
  SemanticImport,
  Upload
} from "../generated/prisma/client.js";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { ObjectStoragePort } from "../storage/object-storage.port.js";
import {
  automaticKc4Mapping,
  SemanticImportParserService
} from "./semantic-import-parser.service.js";

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

test("streams one XLSX sheet with a deeply nested group path", async () => {
  const xlsx = xlsxFixture();
  const updates: Array<Readonly<Record<string, unknown>>> = [];
  const staged: unknown[] = [];
  const parser = new SemanticImportParserService(
    prismaFixture(updates, staged, [], {
      sourceFormat: "XLSX",
      mediaType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      originalName: "key-collector.xlsx",
      sizeBytes: xlsx.length
    }),
    storageFixture(xlsx),
    configFixture()
  );

  const result = await parser.parse(importId);

  assert.deepEqual(result, {
    importId,
    status: "AWAITING_MAPPING"
  });
  assert.equal(staged.length, 2);
  assert.deepEqual(
    (staged[0] as { rawValues: readonly string[] }).rawValues,
    [
      "продвижение сайта",
      "Уровень 1/Уровень 2/Уровень 3/Уровень 4/Уровень 5/Уровень 6/Уровень 7/Уровень 8/Уровень 9/Уровень 10",
      "120"
    ]
  );
  const update = updates.at(-1);
  assert.ok(update);
  assert.equal(update.detectedEncoding, null);
  assert.equal(update.detectedDelimiter, null);
  assert.deepEqual(update.headers, ["Фраза", "Группа", "Частотность"]);
  assert.equal(update.totalRows, 2n);
  assert.equal(update.progressBytes, BigInt(xlsx.length));
});

test("builds a complete native KC4 mapping without manual API input", () => {
  const mapping = automaticKc4Mapping([
    { index: 0, sourceName: "Фраза", suggestedTarget: "keyword.text", confidence: 0.99 },
    { index: 1, sourceName: "Группа", suggestedTarget: "group.path", confidence: 0.99 },
    { index: 2, sourceName: "Key Collector · Цвет группы", suggestedTarget: "custom", confidence: 0.99 },
    { index: 3, sourceName: "Key Collector · YandexDirect · Budget", suggestedTarget: "custom", confidence: 0.99 },
    { index: 4, sourceName: "Яндекс · Позиция", suggestedTarget: "ranking.yandex.position", confidence: 0.99 },
    { index: 5, sourceName: "Google · Позиция", suggestedTarget: "ranking.google.position", confidence: 0.99 },
    { index: 6, sourceName: "Ещё одна фраза", suggestedTarget: "keyword.text", confidence: 0.8 }
  ]);

  assert.deepEqual(mapping, {
    columns: [
      { sourceIndex: 0, target: "keyword.text" },
      { sourceIndex: 1, target: "group.path" },
      { sourceIndex: 2, target: "custom", customName: "Key Collector · Цвет группы" },
      { sourceIndex: 3, target: "custom", customName: "Key Collector · YandexDirect · Budget" },
      { sourceIndex: 4, target: "ranking.yandex.position" },
      { sourceIndex: 5, target: "ranking.google.position" },
      { sourceIndex: 6, target: "custom", customName: "Ещё одна фраза" }
    ],
    defaultLanguage: "ru",
    groupSeparator: "/",
    duplicatePolicy: "OVERWRITE_MAPPED",
    createMissingKeywords: true
  });
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
  events: unknown[],
  fixture: {
    readonly sourceFormat?: string;
    readonly mediaType?: string;
    readonly originalName?: string;
    readonly sizeBytes?: number;
  } = {}
): PrismaService {
  const semanticImport = importRecord(
    fixture.sourceFormat,
    fixture.sizeBytes
  );
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
    findFirst: async () =>
      uploadRecord(
        fixture.mediaType,
        fixture.originalName,
        fixture.sizeBytes
      )
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

function importRecord(
  sourceFormat = "CSV",
  sizeBytes = content.length
): SemanticImport {
  const now = new Date();
  return {
    id: importId,
    workspaceId: "01900000-0000-7000-8000-000000000001",
    projectId: "01900000-0000-7000-8000-000000000002",
    projectDomain: "example.com",
    uploadId,
    actorId: "01900000-0000-7000-8000-000000000003",
    status: "QUEUED",
    stage: "queued",
    sourceFormat,
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
    totalBytes: BigInt(sizeBytes),
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

function uploadRecord(
  mediaType = "text/csv",
  originalName = "keywords.csv",
  sizeBytes = content.length
): Upload {
  const now = new Date();
  return {
    id: uploadId,
    workspaceId: "01900000-0000-7000-8000-000000000001",
    projectId: "01900000-0000-7000-8000-000000000002",
    actorId: "01900000-0000-7000-8000-000000000003",
    status: "READY",
    bucket: "uploads",
    objectKey: "workspace/project/opaque.csv",
    originalName,
    mediaType,
    detectedMediaType: mediaType,
    sizeBytes: BigInt(sizeBytes),
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
    platformProviderCredentials: {},
    integrationCredentialValidation: {
      timeoutMs: 10_000,
      leaseSeconds: 120,
      dispatchSeconds: 15,
      concurrency: 2
    },
    connectorRuntime: {
      dispatchIntervalMs: 1_000,
      paidExecutionEnabled: true,
      shardIndex: 0,
      shardCount: 1,
      rankConcurrency: 1,
      frequencyConcurrency: 1,
      keywordResearchConcurrency: 1,
      xmlStockGlobalHttpConcurrency: 96
    },
    rankPreparation: {
      enabled: false,
      leaseSeconds: 120,
      dispatchSeconds: 15,
      resultPersistenceDispatchIntervalMs: 1_000,
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

function xlsxFixture(): Buffer {
  const xml = (value: string): Uint8Array => strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`
  );
  return Buffer.from(zipSync({
    "[Content_Types].xml": xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
        "</Types>"
    ),
    "_rels/.rels": xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>"
    ),
    "xl/workbook.xml": xml(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        "<sheets>" +
        '<sheet name="Импорт" sheetId="1" r:id="rId1"/>' +
        "</sheets></workbook>"
    ),
    "xl/_rels/workbook.xml.rels": xml(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
        "</Relationships>"
    ),
    "xl/sharedStrings.xml": xml(
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="8" uniqueCount="8">' +
        "<si><t>Фраза</t></si>" +
        "<si><t>Группа</t></si>" +
        "<si><t>Частотность</t></si>" +
        "<si><t>продвижение сайта</t></si>" +
        "<si><t>Уровень 1/Уровень 2/Уровень 3/Уровень 4/Уровень 5/Уровень 6/Уровень 7/Уровень 8/Уровень 9/Уровень 10</t></si>" +
        "<si><t>seo аудит</t></si>" +
        "<si><t>Аудит</t></si>" +
        "<si><t>Коммерция</t></si>" +
        "</sst>"
    ),
    "xl/worksheets/sheet1.xml": xml(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><f>10*12</f><v>120</v></c></row>' +
        '<row r="3"><c r="A3" t="s"><v>5</v></c><c r="B3" t="s"><v>6</v></c><c r="C3"><v>70</v></c></row>' +
        "</sheetData></worksheet>"
    )
  }));
}
