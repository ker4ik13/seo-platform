import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../database/prisma.service.js";
import {
  archiveLegacyKeyCollectorContexts,
  semanticImportCustomValueUpsertSql,
  semanticImportKeywordOverwriteSql,
  SemanticImportService
} from "./semantic-import.service.js";

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

test("archives legacy KC4 contexts without mutating immutable current ranks", async () => {
  let update: Readonly<Record<string, unknown>> | undefined;
  const transaction = {
    trackingContext: {
      findMany: async () => [
        {
          id: "01900000-0000-7000-8000-000000000010",
          configurations: [{
            regionCode: "global",
            regionLabel: "Импорт Key Collector"
          }]
        },
        {
          id: "01900000-0000-7000-8000-000000000011",
          configurations: [{ regionCode: "213", regionLabel: "Москва" }]
        }
      ],
      updateMany: async (input: Readonly<Record<string, unknown>>) => {
        update = input;
        return { count: 1 };
      }
    },
    currentRank: {
      deleteMany: async () => {
        throw new Error("current rank must remain immutable");
      }
    }
  };

  await archiveLegacyKeyCollectorContexts(
    transaction as never,
    context
  );

  assert.deepEqual(
    (update?.where as { id?: { in?: readonly string[] } })?.id?.in,
    ["01900000-0000-7000-8000-000000000010"]
  );
  assert.equal(
    (update?.data as { status?: string })?.status,
    "ARCHIVED"
  );
});

test("bulk custom-value upsert supplies the required update timestamp", () => {
  const query = semanticImportCustomValueUpsertSql([{
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    keywordId: "01900000-0000-7000-8000-000000000010",
    columnId: "01900000-0000-7000-8000-000000000011",
    textValue: "данные Key Collector",
    updatedBy: context.actorId
  }]);
  assert.match(query.sql, /"updated_at"/u);
  assert.match(query.sql, /CURRENT_TIMESTAMP/u);
  assert.match(query.sql, /jsonb_to_recordset/u);
  assert.match(query.sql, /IS DISTINCT FROM EXCLUDED\."text_value"/u);
  assert.equal(query.values.length, 1);
});

test("bulk keyword overwrite is tenant-scoped and increments versions", () => {
  const query = semanticImportKeywordOverwriteSql(context, [{
    id: "01900000-0000-7000-8000-000000000010",
    textOriginal: "обновлённый запрос",
    priority: 7,
    isFavorite: true,
    isTracked: false,
    note: "заметка",
    intent: null,
    targetPageId: null,
    customValues: { source: "Key Collector" }
  }]);
  assert.match(query.sql, /jsonb_to_recordset/u);
  assert.match(query.sql, /"workspace_id"/u);
  assert.match(query.sql, /"project_id"/u);
  assert.match(query.sql, /"version" = "keyword"\."version" \+ 1/u);
  assert.match(query.sql, /"updated_at" = CURRENT_TIMESTAMP/u);
  assert.equal(query.values.length, 7);
});

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
    createMissingKeywords: true,
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
  assert.equal(
    (records[0] as { readonly createMissingKeywords: boolean })
      .createMissingKeywords,
    true
  );
});

test("returns the authoritative resume boundary when a deployment changed chunk size", async () => {
  const transaction = {
    $executeRaw: async () => 1,
    semanticImportReceipt: {
      findUnique: async () => ({
        ...context,
        status: "RECEIVING",
        mappingHash: "a".repeat(64),
        duplicatePolicy: "SKIP_EXISTING",
        createMissingKeywords: true,
        expectedChunks: 33,
        expectedUniqueRows: 161_624n,
        planCode: entitlement.planCode,
        planVersion: entitlement.planVersion,
        storedKeywordsLimit: BigInt(entitlement.storedKeywords),
        keywordsPerProjectLimit: BigInt(entitlement.keywordsPerProject),
        foldersPerProjectLimit: BigInt(entitlement.foldersPerProject),
        reservedKeywords: 161_624n,
        semanticVersionId: null,
        resultSummary: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        completedAt: null,
        chunks: [
          { chunkIndex: 0, inputRows: 5_000 },
          { chunkIndex: 1, inputRows: 5_000 }
        ]
      })
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
    createMissingKeywords: true,
    expectedChunks: 162,
    expectedUniqueRows: "161624",
    expectedNewKeywords: "161624",
    entitlement
  });

  assert.deepEqual(result, {
    importId: context.importId,
    status: "RECEIVING",
    receivedChunks: 2,
    expectedChunks: 33,
    receivedRows: "10000",
    batchRows: 5_000
  });
});

test("rejects a new-keyword reservation for update-only imports", async () => {
  const service = new SemanticImportService({} as PrismaService);
  await assert.rejects(
    () =>
      service.begin({
        ...context,
        mappingHash: "a".repeat(64),
        duplicatePolicy: "MERGE_NON_EMPTY",
        createMissingKeywords: false,
        expectedChunks: 1,
        expectedUniqueRows: "1",
        expectedNewKeywords: "1",
        entitlement
      }),
    BadRequestException
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
    createMissingKeywords: true,
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
  };
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
        createMissingKeywords: true,
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
    createMissingKeywords: true,
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
  const groupMetadata = [{ path: ["Статьи"], color: "#22c55e" }] as const;
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ groupPaths, groupMetadata, rows }))
    .digest("hex");
  const service = new SemanticImportService({
    semanticImportReceipt: {
      findUnique: async () => ({
        ...context,
        status: "RECEIVING",
        mappingHash: "b".repeat(64),
        duplicatePolicy: "SKIP_EXISTING",
        createMissingKeywords: true,
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
    createMissingKeywords: true,
    groupPaths,
    groupMetadata,
    rows
  });

  assert.equal(result.createdGroups, "2");
});

test("seals one contextual KC4 snapshot with current SERP and matching history", async () => {
  const now = new Date("2026-08-07T12:00:00.000Z");
  const keywordId = "01900000-0000-7000-8000-000000000010";
  const contextId = "01900000-0000-7000-8000-000000000011";
  const assignmentId = "01900000-0000-7000-8000-000000000012";
  let currentKeyword: {
    id: string;
    workspaceId: string;
    projectId: string;
    textOriginal: string;
    textNormalized: string;
    normalizedHash: string;
    language: string;
    priority: number;
    isFavorite: boolean;
    intent: string | null;
    note: string | null;
    status: string;
    clusterId: string | null;
    targetPageId: string | null;
    isTracked: boolean;
    customValues: Readonly<Record<string, string>>;
    sourceMode: string;
    sourceId: string | null;
    createdBy: string;
    updatedBy: string;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  } = {
    id: keywordId,
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    textOriginal: "SEO",
    textNormalized: "seo",
    normalizedHash: "f".repeat(64),
    language: "ru",
    priority: 0,
    isFavorite: false,
    intent: null,
    note: null,
    status: "ACTIVE",
    clusterId: null,
    targetPageId: null,
    isTracked: true,
    customValues: {},
    sourceMode: "MANUAL",
    sourceId: null,
    createdBy: context.actorId,
    updatedBy: context.actorId,
    version: 7,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
  let manifestKeywordVersion: number | undefined;
  let manifestProjectDomain: string | undefined;
  let manifestCount = 0;
  const persistedSerpPositions: number[] = [];
  const receipt = {
    ...context,
    status: "RECEIVING",
    mappingHash: "b".repeat(64),
    duplicatePolicy: "MERGE_NON_EMPTY",
    createMissingKeywords: false,
    expectedChunks: 1,
    expectedUniqueRows: 1n,
    planCode: "TEAM",
    planVersion: 1,
    storedKeywordsLimit: 2_000_000n,
    keywordsPerProjectLimit: 2_000_000n,
    foldersPerProjectLimit: 500n,
    reservedKeywords: 0n,
    semanticVersionId: null,
    resultSummary: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null
  } as const;
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ keywordId }],
    semanticImportReceipt: {
      findUnique: async () => receipt,
      update: async () => receipt
    },
    semanticImportChunkReceipt: {
      findUnique: async () => null,
      create: async ({ data }: { data: Readonly<Record<string, unknown>> }) => ({
        ...data,
        createdKeywords: BigInt(Number(data.createdKeywords ?? 0)),
        updatedKeywords: BigInt(Number(data.updatedKeywords ?? 0)),
        skippedKeywords: BigInt(Number(data.skippedKeywords ?? 0)),
        createdGroups: BigInt(Number(data.createdGroups ?? 0)),
        createdPages: BigInt(Number(data.createdPages ?? 0)),
        createdTags: BigInt(Number(data.createdTags ?? 0)),
        createdMetricSnapshots: BigInt(
          Number(data.createdMetricSnapshots ?? 0)
        ),
        createdAt: now
      })
    },
    keyword: {
      findMany: async () => [currentKeyword],
      update: async () => {
        currentKeyword = {
          ...currentKeyword,
          sourceMode: "IMPORT",
          sourceId: context.importId,
          version: currentKeyword.version + 1,
          updatedAt: now
        };
        return currentKeyword;
      },
      updateMany: async () => ({ count: 0 })
    },
    keywordGroupMembership: {
      findMany: async () => [],
      createMany: async () => ({ count: 0 }),
      deleteMany: async () => ({ count: 0 })
    },
    keywordGroup: {
      findFirst: async ({ where }: { where: { systemKind: string } }) => ({
        id:
          where.systemKind === "UNGROUPED"
            ? "01900000-0000-7000-8000-000000000013"
            : "01900000-0000-7000-8000-000000000014"
      })
    },
    trackingContext: {
      findFirst: async () => ({ id: contextId, version: 1 }),
      findUnique: async () => null,
      create: async ({ data }: { data: { id: string } }) => ({
        id: data.id,
        version: 1
      })
    },
    trackingContextVersion: {
      findFirst: async () => ({
        configurationVersion: 1,
        configurationHash: "a".repeat(64)
      }),
      create: async () => undefined
    },
    trackingContextKeywordAssignment: {
      findMany: async () => [{ id: assignmentId, keywordId }],
      createMany: async () => ({ count: 0 })
    },
    rankExecutionManifest: {
      create: async ({ data }: { data: { projectDomain: string } }) => {
        manifestCount += 1;
        manifestProjectDomain = data.projectDomain;
      },
      update: async () => {
        assert.equal(manifestKeywordVersion, currentKeyword.version);
        return undefined;
      }
    },
    rankExecutionManifestChunk: {
      create: async () => undefined
    },
    rankExecutionManifestEntry: {
      createMany: async ({ data }: { data: readonly { keywordVersion: number }[] }) => {
        manifestKeywordVersion = data[0]?.keywordVersion;
        return { count: data.length };
      }
    },
    rankSnapshot: {
      createMany: async ({ data }: { data: readonly unknown[] }) => ({
        count: data.length
      })
    },
    rankSerpResult: {
      createMany: async ({ data }: { data: readonly { position: number }[] }) => {
        persistedSerpPositions.push(...data.map(({ position }) => position));
        return { count: data.length };
      }
    },
    currentRank: {
      findMany: async () => [],
      create: async () => undefined
    },
    rankChunkIngestReceipt: {
      create: async () => undefined
    }
  };
  const prisma = {
    semanticImportReceipt: transaction.semanticImportReceipt,
    semanticImportChunkReceipt: {
      findUnique: async () => null
    },
    $transaction: async (
      callback: (client: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
  };
  const rows = [
    {
      sourceRowNumber: "1",
      textOriginal: "SEO",
      textNormalized: "seo",
      normalizedHash: "f".repeat(64),
      language: "ru",
      positions: [
        {
          source: "KEY_COLLECTOR" as const,
          searchEngine: "YANDEX" as const,
          countryCode: "RU",
          regionCode: "213",
          regionLabel: "Москва",
          language: "ru",
          device: "DESKTOP" as const,
          observedAt: "2026-08-01T12:00:00.000Z",
          found: true,
          position: 9,
          rankingUrl: "https://example.com/first",
          serpResults: [
            { position: 9, rankingUrl: "https://example.com/first" },
            { position: 43, rankingUrl: "https://example.com/second" }
          ]
        }
      ],
      positionHistory: [{
        source: "KEY_COLLECTOR" as const,
        searchEngine: "YANDEX" as const,
        countryCode: "RU",
        regionCode: "213",
        regionLabel: "Москва",
        language: "ru",
        device: "DESKTOP" as const,
        observedAt: "2026-08-01T12:00:00.000Z",
        found: true,
        position: 9,
        rankingUrl: "https://example.com/first"
      }],
      customValues: {}
    }
  ];
  const projectDomain = "example.com";
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ projectDomain, rows }))
    .digest("hex");

  const result = await new SemanticImportService(
    prisma as unknown as PrismaService
  ).applyChunk({
    ...context,
    projectDomain,
    chunkIndex: 0,
    payloadHash,
    duplicatePolicy: "MERGE_NON_EMPTY",
    createMissingKeywords: false,
    rows
  });

  assert.equal(result.updatedKeywords, "1");
  assert.equal(manifestKeywordVersion, 8);
  assert.equal(manifestProjectDomain, projectDomain);
  assert.equal(manifestCount, 1);
  assert.deepEqual(persistedSerpPositions, [9, 43]);
});
