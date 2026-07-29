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
      timeout: 30_000
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

function validInput(): InternalIngestRankChunkInput {
  const value = command();
  return {
    ...value,
    ingestEnvelopeHash: rankChunkIngestHash(value, sealedChunk())
  };
}

function command(
  overrides: Partial<InternalRankChunkIngestCommand> = {}
): InternalRankChunkIngestCommand {
  return {
    schemaVersion: "rank-ingest@1",
    workspaceId,
    projectId,
    actorId,
    jobId,
    jobItemId,
    manifestId,
    chunkIndex: 0,
    manifestChunkHash: sealedChunk().chunkHash,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    providerRequestId: "provider-task-1",
    connectorVersion: "1.0.0",
    observedAt,
    results: [
      {
        manifestEntryId: entryId,
        keywordId,
        dataQualityFlags: [
          "ABSOLUTE_POSITION_UNAVAILABLE",
          "PIXEL_POSITION_UNAVAILABLE",
          "TITLE_UNAVAILABLE",
          "SNIPPET_UNAVAILABLE"
        ],
        found: true,
        position: 4,
        rankingUrl: "https://example.com/rank",
        normalizedRankingUrl: "https://example.com/rank",
        resultType: "ORGANIC",
        serpFeatures: []
      }
    ],
    ...overrides
  };
}

function sealedChunk(): InternalRankManifestChunk {
  const entry = {
    id: entryId,
    sequence: 0,
    assignmentId,
    keywordId,
    keywordVersion: 1,
    keywordText,
    keywordTextHash: hash(utf8Sha256(keywordText)),
    language: "en"
  };
  const withoutHash: InternalRankManifestChunk = {
    workspaceId,
    projectId,
    jobId,
    manifestId,
    chunkIndex: 0,
    hashSchemaVersion: "rank-manifest-chunk@1",
    chunkHash: hash("0".repeat(64)),
    entries: [entry]
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

function hash(value: string): RankManifestHash {
  return { algorithm: "SHA_256", value };
}

function resultHarness() {
  let status: "SEALED" | "CLOSED" = "SEALED";
  let receipt: Record<string, unknown> | null = null;
  let snapshotWrites = 0;
  let currentUpserts = 0;
  let receiptWrites = 0;
  let persistedSnapshot: unknown;
  const transactionOptions: unknown[] = [];

  const chunk = sealedChunk();
  const entry = chunk.entries[0]!;
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
            provider: "ARSENKIN",
            operation: "POSITIONS",
            pairCount: 1,
            chunkCount: 1,
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
            entryCount: 1
          }
        ];
      }
      if (sql.includes("SELECT ARRAY(")) {
        return [{ ids: [snapshotId] }];
      }
      if (sql.includes('INSERT INTO "current_ranks"')) {
        currentUpserts += 1;
        return [{ updatedCount: 1 }];
      }
      throw new Error(`Unexpected SQL in rank result test: ${sql}`);
    },
    rankExecutionManifestEntry: {
      findMany: async () => [
        {
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
        }
      ]
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
        assert.equal(data.length, 1);
        persistedSnapshot = data[0];
        return { count: 1 };
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
    closeManifest() {
      status = "CLOSED";
    },
    get snapshotWrites() {
      return snapshotWrites;
    },
    get currentUpserts() {
      return currentUpserts;
    },
    get receiptWrites() {
      return receiptWrites;
    },
    get persistedSnapshot() {
      return persistedSnapshot;
    }
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
