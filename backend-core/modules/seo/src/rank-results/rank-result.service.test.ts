import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import {
  rankManifestChunkHashPreimage,
  type InternalIngestRankChunkInput,
  type InternalRankChunkIngestCommand,
  type InternalRankManifestChunk,
  type RankManifestHash
} from "@seo-platform/contracts";
import {
  canonicalJsonSha256,
  utf8Sha256
} from "@seo-platform/contracts/canonical-json";
import {
  rankChunkIngestHash
} from "@seo-platform/contracts/rank-results-canonical";
import type { PrismaService } from "../database/prisma.service.js";
import { RankResultService } from "./rank-result.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const jobItemId = "01900000-0000-7000-8000-000000000005";
const manifestId = "01900000-0000-7000-8000-000000000006";
const trackingContextId =
  "01900000-0000-7000-8000-000000000007";
const entryId = "01900000-0000-7000-8000-000000000008";
const assignmentId = "01900000-0000-7000-8000-000000000009";
const keywordId = "01900000-0000-7000-8000-00000000000a";
const snapshotId = "01900000-0000-7000-8000-00000000000b";
const observedAt = "2026-07-29T12:00:00.000Z";
const appliedAt = new Date("2026-07-29T12:00:01.000Z");
const keywordText = "seo platform";

test("persists one sealed chunk and updates current ranks atomically", async () => {
  const harness = resultHarness();
  const result = await new RankResultService(
    harness.prisma
  ).ingest(validInput());

  assert.equal(harness.snapshotWrites, 1);
  assert.equal(harness.currentUpserts, 1);
  assert.equal(harness.receiptWrites, 1);
  assert.equal(result.status, "APPLIED");
  assert.equal(result.persistedCount, "1");
  assert.equal(result.foundCount, "1");
  assert.equal(result.currentUpdatedCount, "1");
  assert.equal(result.currentSkippedCount, "0");
  assert.equal(result.manifestChunkHash.value, sealedChunk().chunkHash.value);
  assert.deepEqual(harness.transactionOptions, [
    {
      isolationLevel: "ReadCommitted",
      maxWait: 5_000,
      timeout: 120_000
    }
  ]);
  assert.deepEqual(
    harness.persistedSnapshot,
    {
      id: snapshotId,
      workspaceId,
      projectId,
      keywordId,
      trackingContextId,
      configurationVersion: 2,
      manifestId,
      manifestEntryId: entryId,
      chunkIndex: 0,
      sequence: 0,
      jobId,
      jobItemId,
      observedAt: new Date(observedAt),
      positionTrackingEnabled: true,
      serpFeatures: [],
      dataQualityFlags: [
        "ABSOLUTE_POSITION_UNAVAILABLE",
        "PIXEL_POSITION_UNAVAILABLE",
        "TITLE_UNAVAILABLE",
        "SNIPPET_UNAVAILABLE"
      ],
      provider: "ARSENKIN",
      sourceMode: "BYOK",
      providerRequestId: "provider-task-1",
      connectorVersion: "1.0.0",
      found: true,
      position: 4,
      rankingUrl: "https://example.com/rank",
      normalizedRankingUrl: "https://example.com/rank",
      resultType: "ORGANIC"
    }
  );
});

test("exact replay after manifest close returns the immutable receipt", async () => {
  const harness = resultHarness();
  const service = new RankResultService(harness.prisma);
  const first = await service.ingest(validInput());
  harness.closeManifest();
  const replay = await service.ingest(validInput());

  assert.deepEqual(replay, first);
  assert.equal(harness.snapshotWrites, 1);
  assert.equal(harness.currentUpserts, 1);
  assert.equal(harness.receiptWrites, 1);
});

test("rejects a changed ingest envelope for an already applied chunk", async () => {
  const harness = resultHarness();
  const service = new RankResultService(harness.prisma);
  await service.ingest(validInput());

  const changedCommand = command({
    actorId: "01900000-0000-7000-8000-000000000099"
  });
  const changedInput: InternalIngestRankChunkInput = {
    ...changedCommand,
    ingestEnvelopeHash: rankChunkIngestHash(
      changedCommand,
      sealedChunk()
    )
  };
  await assert.rejects(
    () => service.ingest(changedInput),
    (error: unknown) =>
      hasError(error, 409, "RANK_INGEST_IDEMPOTENCY_CONFLICT")
  );
  assert.equal(harness.snapshotWrites, 1);
});

test("keeps a foreign tenant indistinguishable from a missing manifest", async () => {
  const harness = resultHarness();
  await assert.rejects(
    () =>
      new RankResultService(harness.prisma).ingest({
        ...validInput(),
        workspaceId:
          "01900000-0000-7000-8000-000000000099"
      }),
    (error: unknown) =>
      error instanceof HttpException && error.getStatus() === 404
  );
  assert.equal(harness.snapshotWrites, 0);
});

test("persists 15k rank snapshots in bounded createMany batches", async () => {
  const harness = resultHarness(15_000);

  const result = await new RankResultService(
    harness.prisma
  ).ingest(validInput(15_000));

  assert.equal(result.persistedCount, "15000");
  assert.equal(harness.snapshotWrites, 15);
  assert.equal(harness.snapshotBatchSizes.length, 15);
  assert.ok(
    harness.snapshotBatchSizes.every((size) => size === 1_000)
  );
  assert.equal(harness.currentUpserts, 1);
  assert.equal(harness.receiptWrites, 1);
});

test("persists normalized SERP evidence with its immutable snapshot", async () => {
  const base = command();
  const found = base.results[0]!;
  const value = command({
    provider: "XMLSTOCK",
    connectorVersion: "xmlstock-serp@1.0.0",
    results: [{
      ...found,
      serpResults: [{
        position: 1,
        rankingUrl: "https://competitor.example/",
        normalizedRankingUrl: "https://competitor.example/",
        faviconUrl: "https://search-assets.example/competitor.png",
        title: "Competitor"
      }]
    }]
  });
  const input: InternalIngestRankChunkInput = {
    ...value,
    ingestEnvelopeHash: rankChunkIngestHash(value, sealedChunk())
  };
  const harness = resultHarness(1, "XMLSTOCK");

  await new RankResultService(harness.prisma).ingest(input);

  assert.equal(harness.serpWrites, 1);
  assert.deepEqual(harness.persistedSerpResult, {
    snapshotObservedAt: new Date(observedAt),
    snapshotId,
    position: 1,
    rankingUrl: "https://competitor.example/",
    normalizedRankingUrl: "https://competitor.example/",
    faviconUrl: "https://search-assets.example/competitor.png",
    title: "Competitor",
    createdAt: appliedAt
  });
});

test("keeps competitor SERP evidence out of position projections when disabled", async () => {
  const harness = resultHarness(
    1,
    "ARSENKIN",
    competitorExecution(false)
  );

  const result = await new RankResultService(harness.prisma).ingest(
    validInput()
  );

  assert.equal(result.persistedCount, "1");
  assert.equal(result.currentUpdatedCount, "0");
  assert.equal(result.currentSkippedCount, "1");
  assert.equal(harness.currentInputCount, 0);
  assert.equal(
    (harness.persistedSnapshot as { positionTrackingEnabled?: unknown })
      .positionTrackingEnabled,
    false
  );
});

function validInput(entryCount = 1): InternalIngestRankChunkInput {
  const value = command({}, entryCount);
  return {
    ...value,
    ingestEnvelopeHash: rankChunkIngestHash(
      value,
      sealedChunk(entryCount)
    )
  };
}

function command(
  overrides: Partial<InternalRankChunkIngestCommand> = {},
  entryCount = 1
): InternalRankChunkIngestCommand {
  const chunk = sealedChunk(entryCount);
  return {
    schemaVersion: "rank-ingest@1",
    workspaceId,
    projectId,
    actorId,
    jobId,
    jobItemId,
    manifestId,
    chunkIndex: 0,
    manifestChunkHash: chunk.chunkHash,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    providerRequestId: "provider-task-1",
    connectorVersion: "1.0.0",
    observedAt,
    results: chunk.entries.map((entry, index) => ({
        manifestEntryId: entry.id,
        keywordId: entry.keywordId,
        dataQualityFlags: [
          "ABSOLUTE_POSITION_UNAVAILABLE",
          "PIXEL_POSITION_UNAVAILABLE",
          "TITLE_UNAVAILABLE",
          "SNIPPET_UNAVAILABLE"
        ],
        found: true,
        position: index === 0 ? 4 : (index % 100) + 1,
        rankingUrl:
          index === 0
            ? "https://example.com/rank"
            : `https://example.com/rank/${index}`,
        normalizedRankingUrl:
          index === 0
            ? "https://example.com/rank"
            : `https://example.com/rank/${index}`,
        resultType: "ORGANIC",
        serpFeatures: []
      })),
    ...overrides
  };
}

function sealedChunk(entryCount = 1): InternalRankManifestChunk {
  const entries = Array.from({ length: entryCount }, (_, index) =>
    manifestEntry(index)
  );
  const withoutHash: InternalRankManifestChunk = {
    workspaceId,
    projectId,
    jobId,
    manifestId,
    chunkIndex: 0,
    hashSchemaVersion: "rank-manifest-chunk@1",
    chunkHash: hash("0".repeat(64)),
    entries
  };
  return {
    ...withoutHash,
    chunkHash: hash(
      canonicalJsonSha256(
        "rank-manifest-chunk@1",
        rankManifestChunkHashPreimage(withoutHash)
      )
    )
  };
}

function manifestEntry(index: number) {
  const text = index === 0 ? keywordText : `seo platform ${index}`;
  return {
    id: index === 0 ? entryId : testUuid(100_000 + index),
    sequence: index,
    assignmentId:
      index === 0 ? assignmentId : testUuid(200_000 + index),
    keywordId: index === 0 ? keywordId : testUuid(300_000 + index),
    keywordVersion: 1,
    keywordText: text,
    keywordTextHash: hash(utf8Sha256(text)),
    language: "en"
  };
}

function testUuid(suffix: number): string {
  return `01900000-0000-7000-8000-${String(suffix).padStart(12, "0")}`;
}

function hash(value: string): RankManifestHash {
  return { algorithm: "SHA_256", value };
}

function resultHarness(
  entryCount = 1,
  manifestProvider: "ARSENKIN" | "XMLSTOCK" = "ARSENKIN",
  manifestExecution: Record<string, unknown> = positionExecution()
) {
  let status: "SEALED" | "CLOSED" = "SEALED";
  let receipt: Record<string, unknown> | null = null;
  let snapshotWrites = 0;
  let currentUpserts = 0;
  let currentInputCount = 0;
  let receiptWrites = 0;
  let serpWrites = 0;
  let persistedSnapshot: unknown;
  let persistedSerpResult: unknown;
  const snapshotBatchSizes: number[] = [];
  const transactionOptions: unknown[] = [];

  const chunk = sealedChunk(entryCount);
  const transaction = {
    $queryRaw: async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const sql = strings.join("");
      if (sql.includes('FROM "rank_execution_manifests"')) {
        if (
          values[0] !== workspaceId ||
          values[1] !== projectId ||
          values[2] !== manifestId ||
          values[3] !== jobId
        ) {
          return [];
        }
        return [
          {
            id: manifestId,
            workspaceId,
            projectId,
            jobId,
            trackingContextId,
            configurationVersion: 2,
            provider: manifestProvider,
            operation: "POSITIONS",
            execution: manifestExecution,
            pairCount: entryCount,
            chunkCount: 1,
            chunkSize: manifestProvider === "XMLSTOCK" ? 1 : 15_000,
            status,
            appliedAt
          }
        ];
      }
      if (
        sql.includes('FROM "rank_execution_manifest_chunks"')
      ) {
        return [
          {
            workspaceId,
            projectId,
            manifestId,
            chunkIndex: 0,
            hashSchemaVersion: "rank-manifest-chunk@1",
            chunkHash: Buffer.from(chunk.chunkHash.value, "hex"),
            entryCount
          }
        ];
      }
      if (sql.includes("SELECT ARRAY(")) {
        return [
          {
            ids: Array.from({ length: entryCount }, (_, index) =>
              index === 0 ? snapshotId : testUuid(400_000 + index)
            )
          }
        ];
      }
      if (sql.includes('INSERT INTO "current_ranks"')) {
        currentUpserts += 1;
        const rows = JSON.parse(String(values[0])) as readonly unknown[];
        currentInputCount += rows.length;
        return [{ updatedCount: rows.length }];
      }
      throw new Error(`Unexpected SQL in rank result test: ${sql}`);
    },
    rankExecutionManifestEntry: {
      findMany: async () =>
        chunk.entries.map((entry) => ({
          id: entry.id,
          sequence: entry.sequence,
          assignmentId: entry.assignmentId,
          keywordId: entry.keywordId,
          keywordVersion: entry.keywordVersion,
          keywordText: entry.keywordText,
          keywordTextHash: Buffer.from(
            entry.keywordTextHash.value,
            "hex"
          ),
          language: entry.language
        }))
    },
    rankChunkIngestReceipt: {
      findUnique: async () => receipt,
      findFirst: async () => null,
      create: async ({
        data
      }: {
        data: Record<string, unknown>;
      }) => {
        receiptWrites += 1;
        receipt = { ...data };
        return receipt;
      }
    },
    rankSnapshot: {
      createMany: async ({
        data
      }: {
        data: readonly unknown[];
      }) => {
        snapshotWrites += 1;
        snapshotBatchSizes.push(data.length);
        persistedSnapshot ??= data[0];
        return { count: data.length };
      }
    },
    rankSerpResult: {
      createMany: async ({ data }: { data: readonly unknown[] }) => {
        serpWrites += 1;
        persistedSerpResult ??= data[0];
        return { count: data.length };
      }
    }
  };
  const prisma = {
    $transaction: async (
      work: (value: unknown) => Promise<unknown>,
      options: unknown
    ) => {
      transactionOptions.push(options);
      return work(transaction);
    }
  } as unknown as PrismaService;

  return {
    prisma,
    transactionOptions,
    snapshotBatchSizes,
    closeManifest() {
      status = "CLOSED";
    },
    get snapshotWrites() {
      return snapshotWrites;
    },
    get currentUpserts() {
      return currentUpserts;
    },
    get currentInputCount() {
      return currentInputCount;
    },
    get receiptWrites() {
      return receiptWrites;
    },
    get serpWrites() {
      return serpWrites;
    },
    get persistedSnapshot() {
      return persistedSnapshot;
    },
    get persistedSerpResult() {
      return persistedSerpResult;
    }
  };
}

function positionExecution(): Record<string, unknown> {
  return {
    searchEngine: "GOOGLE",
    countryCode: "US",
    regionCode: "us-ca",
    language: "en",
    device: "DESKTOP",
    depth: 30,
    domainMatchRule: { mode: "EXACT_HOST" },
    safeSearch: false,
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE",
    providerMappingVersion: "arsenkin-google-live@2"
  };
}

function competitorExecution(
  saveProjectPosition: boolean
): Record<string, unknown> {
  return {
    ...positionExecution(),
    purpose: "COMPETITOR_SERP",
    saveProjectPosition,
    providerMappingVersion: "arsenkin-check-top-google-live@1"
  };
}

function hasError(
  error: unknown,
  status: number,
  code: string
): boolean {
  if (!(error instanceof HttpException) || error.getStatus() !== status) {
    return false;
  }
  const response = error.getResponse();
  return (
    typeof response === "object" &&
    response !== null &&
    "error" in response &&
    typeof response.error === "object" &&
    response.error !== null &&
    "code" in response.error &&
    response.error.code === code
  );
}
