import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.service.js";
import { SemanticImportService } from "./semantic-import.service.js";

const context = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  importId: "01900000-0000-7000-8000-000000000004"
} as const;
const entitlement = {
  planCode: "TEAM",
  planVersion: 1,
  storedKeywords: 2_000_000,
  keywordsPerProject: 2_000_000,
  foldersPerProject: 500,
  trackedContextPairs: 50_000
} as const;

test("normalizes keywords canonically and marks existing project rows", async () => {
  let observedWhere: unknown;
  const service = new SemanticImportService({
    keyword: {
      findMany: async ({ where }: { where: unknown }) => {
        observedWhere = where;
        return [
          {
            language: "ru",
            normalizedHash:
              "b81252c9446725bfa4ba814d1ca710b25df2f5262bb351e536b98a64bac1a5d8"
          }
        ];
      }
    }
  } as unknown as PrismaService);

  const result = await service.normalizeKeywords({
    ...context,
    rows: [
      { rowNumber: "1", text: "  ЁЖИК   SEO ", language: "ru" },
      { rowNumber: "2", text: "Site Audit", language: "en" }
    ]
  });

  assert.equal(result.rows[0]?.textOriginal, "ЁЖИК   SEO");
  assert.equal(result.rows[0]?.textNormalized, "ежик seo");
  assert.equal(result.rows[0]?.existsInProject, true);
  assert.equal(result.rows[1]?.existsInProject, false);
  assert.ok(observedWhere);
});

test("creates an idempotent semantic import receipt", async () => {
  const records: unknown[] = [];
  const transaction = {
    $executeRaw: async () => 1,
    keyword: {
      count: async () => 0
    },
    semanticImportReceipt: {
      findUnique: async () => null,
      aggregate: async () => ({
        _sum: { reservedKeywords: null }
      }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        records.push(data);
        return {
          ...data,
          status: "RECEIVING",
          expectedUniqueRows: BigInt(String(data.expectedUniqueRows)),
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: null,
          semanticVersionId: null,
          resultSummary: null
        };
      }
    }
  };
  const service = new SemanticImportService({
    $transaction: async (
      callback: (client: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService);

  const result = await service.begin({
    ...context,
    mappingHash: "a".repeat(64),
    duplicatePolicy: "SKIP_EXISTING",
    expectedChunks: 2,
    expectedUniqueRows: "10",
    expectedNewKeywords: "8",
    entitlement
  });

  assert.equal(result.status, "RECEIVING");
  assert.equal(result.receivedChunks, 0);
  assert.equal(records.length, 1);
  assert.equal(
    (records[0] as { readonly reservedKeywords: bigint })
      .reservedKeywords,
    8n
  );
});

test("aborts an empty receipt and releases its remaining capacity", async () => {
  let update:
    | Readonly<Record<string, unknown>>
    | undefined;
  const receipt = {
    ...context,
    status: "RECEIVING",
    mappingHash: "a".repeat(64),
    duplicatePolicy: "SKIP_EXISTING",
    expectedChunks: 2,
    expectedUniqueRows: 10n,
    planCode: "TEAM",
    planVersion: 1,
    storedKeywordsLimit: 2_000_000n,
    keywordsPerProjectLimit: 2_000_000n,
    reservedKeywords: 8n,
    semanticVersionId: null,
    resultSummary: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    _count: { chunks: 0 }
  } as const;
  const transaction = {
    $executeRaw: async () => 1,
    semanticImportReceipt: {
      findUnique: async () => receipt,
      update: async ({
        data
      }: {
        data: Readonly<Record<string, unknown>>;
      }) => {
        update = data;
        return receipt;
      }
    }
  };
  const service = new SemanticImportService({
    $transaction: async (
      callback: (client: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService);

  const result = await service.abort({
    ...context,
    reason: "CANCELLED"
  });

  assert.deepEqual(result, {
    importId: context.importId,
    status: "ABORTED",
    receivedChunks: 0
  });
  assert.equal(update?.status, "ABORTED");
  assert.equal(update?.reservedKeywords, 0n);
});

test("returns an applied chunk idempotently and rejects payload substitution", async () => {
  const rows = [
    {
      sourceRowNumber: "1",
      textOriginal: "SEO",
      textNormalized: "seo",
      normalizedHash: "a".repeat(64),
      language: "en",
      customValues: {}
    }
  ];
  const payloadHash = createHash("sha256")
    .update(JSON.stringify(rows))
    .digest("hex");
  const service = new SemanticImportService({
    semanticImportReceipt: {
      findUnique: async () => ({
        ...context,
        status: "RECEIVING",
        mappingHash: "b".repeat(64),
        duplicatePolicy: "SKIP_EXISTING",
        expectedChunks: 1,
        expectedUniqueRows: 1n
      })
    },
    semanticImportChunkReceipt: {
      findUnique: async () => ({
        importId: context.importId,
        chunkIndex: 0,
        payloadHash,
        inputRows: 1,
        createdKeywords: 1n,
        updatedKeywords: 0n,
        skippedKeywords: 0n,
        createdGroups: 0n,
        createdPages: 0n,
        createdTags: 0n,
        createdMetricSnapshots: 0n,
        createdAt: new Date()
      })
    }
  } as unknown as PrismaService);
  const input = {
    ...context,
    chunkIndex: 0,
    payloadHash,
    duplicatePolicy: "SKIP_EXISTING" as const,
    rows
  };

  assert.equal((await service.applyChunk(input)).createdKeywords, "1");
  await assert.rejects(
    () =>
      service.applyChunk({
        ...input,
        payloadHash: "c".repeat(64)
      }),
    BadRequestException
  );
});

test("binds a KC4 group manifest into the idempotent chunk hash", async () => {
  const rows = [
    {
      sourceRowNumber: "1",
      textOriginal: "SEO",
      textNormalized: "seo",
      normalizedHash: "d".repeat(64),
      language: "en",
      customValues: {}
    }
  ];
  const groupPaths = [["Статьи"], ["Статьи", "Пустая папка"]] as const;
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ groupPaths, rows }))
    .digest("hex");
  const service = new SemanticImportService({
    semanticImportReceipt: {
      findUnique: async () => ({
        ...context,
        status: "RECEIVING",
        mappingHash: "b".repeat(64),
        duplicatePolicy: "SKIP_EXISTING",
        expectedChunks: 1,
        expectedUniqueRows: 1n
      })
    },
    semanticImportChunkReceipt: {
      findUnique: async () => ({
        importId: context.importId,
        chunkIndex: 0,
        payloadHash,
        inputRows: 1,
        createdKeywords: 1n,
        updatedKeywords: 0n,
        skippedKeywords: 0n,
        createdGroups: 2n,
        createdPages: 0n,
        createdTags: 0n,
        createdMetricSnapshots: 0n,
        createdAt: new Date()
      })
    }
  } as unknown as PrismaService);

  const result = await service.applyChunk({
    ...context,
    chunkIndex: 0,
    payloadHash,
    duplicatePolicy: "SKIP_EXISTING",
    groupPaths,
    rows
  });

  assert.equal(result.createdGroups, "2");
});
