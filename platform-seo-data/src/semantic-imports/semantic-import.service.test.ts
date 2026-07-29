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
  const service = new SemanticImportService({
    semanticImportReceipt: {
      findUnique: async () => null,
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
  } as unknown as PrismaService);

  const result = await service.begin({
    ...context,
    mappingHash: "a".repeat(64),
    duplicatePolicy: "SKIP_EXISTING",
    expectedChunks: 2,
    expectedUniqueRows: "10"
  });

  assert.equal(result.status, "RECEIVING");
  assert.equal(result.receivedChunks, 0);
  assert.equal(records.length, 1);
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
