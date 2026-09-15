import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  applySemanticImportChunkInput,
  beginSemanticImportInput,
  normalizeSemanticKeywordsInput
} from "./semantic-import-input.js";

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

test("parses bounded keyword normalization and import receipt commands", () => {
  assert.deepEqual(
    normalizeSemanticKeywordsInput({
      ...context,
      rows: [{ rowNumber: "1", text: "  Купить SEO  ", language: "ru" }]
    }).rows,
    [{ rowNumber: "1", text: "Купить SEO", language: "ru" }]
  );
  assert.equal(
    beginSemanticImportInput({
      ...context,
      mappingHash: "a".repeat(64),
      duplicatePolicy: "SKIP_EXISTING",
      createMissingKeywords: false,
      expectedChunks: 2,
      expectedUniqueRows: "500",
      expectedNewKeywords: "0",
      entitlement
    }).createMissingKeywords,
    false
  );
});

test("keeps pre-deployment internal commands create-enabled", () => {
  assert.equal(
    beginSemanticImportInput({
      ...context,
      mappingHash: "a".repeat(64),
      duplicatePolicy: "MERGE_NON_EMPTY",
      expectedChunks: 1,
      expectedUniqueRows: "1",
      expectedNewKeywords: "1",
      entitlement
    }).createMissingKeywords,
    true
  );
});

test("accepts a five-thousand-row normalization batch and rejects overflow", () => {
  const rows = Array.from({ length: 5_000 }, (_, index) => ({
    rowNumber: String(index + 1),
    text: `запрос ${index + 1}`,
    language: "ru"
  }));
  assert.equal(normalizeSemanticKeywordsInput({ ...context, rows }).rows.length, 5_000);
  assert.throws(
    () => normalizeSemanticKeywordsInput({
      ...context,
      rows: [...rows, { rowNumber: "5001", text: "лишний", language: "ru" }]
    }),
    BadRequestException
  );
});

test("accepts the shared five-thousand-row publication chunk and rejects overflow", () => {
  const rows = Array.from({ length: 5_000 }, (_, index) => ({
    sourceRowNumber: String(index + 1),
    textOriginal: `SEO ${index + 1}`,
    textNormalized: `seo ${index + 1}`,
    normalizedHash: (index + 1).toString(16).padStart(64, "0"),
    language: "ru",
    customValues: {}
  }));
  const command = {
    ...context,
    chunkIndex: 0,
    payloadHash: "c".repeat(64),
    duplicatePolicy: "OVERWRITE_MAPPED" as const,
    createMissingKeywords: true
  };
  assert.equal(
    applySemanticImportChunkInput({ ...command, rows }).rows.length,
    5_000
  );
  assert.throws(
    () => applySemanticImportChunkInput({
      ...command,
      rows: [
        ...rows,
        {
          ...rows[0],
          sourceRowNumber: "5001",
          normalizedHash: "f".repeat(64)
        }
      ]
    }),
    BadRequestException
  );
});

test("rejects duplicate chunk keys and values outside PostgreSQL bigint", () => {
  const row = {
    sourceRowNumber: "1",
    textOriginal: "SEO",
    textNormalized: "seo",
    normalizedHash: "b".repeat(64),
    language: "ru",
    customValues: {}
  };
  assert.throws(
    () =>
      applySemanticImportChunkInput({
        ...context,
        chunkIndex: 0,
        payloadHash: "c".repeat(64),
        duplicatePolicy: "SKIP_EXISTING",
        createMissingKeywords: false,
        rows: [row, { ...row, sourceRowNumber: "2" }]
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      normalizeSemanticKeywordsInput({
        ...context,
        rows: [
          {
            rowNumber: "9223372036854775808",
            text: "SEO",
            language: "ru"
          }
        ]
      }),
    BadRequestException
  );
});

test("accepts deep KC4 paths and bounded imported positions", () => {
  const groupPath = Array.from({ length: 20 }, (_, index) =>
    `Уровень ${index + 1}`
  );
  const result = applySemanticImportChunkInput({
    ...context,
    projectDomain: "Example.COM",
    chunkIndex: 0,
    payloadHash: "d".repeat(64),
    duplicatePolicy: "MERGE_NON_EMPTY",
    createMissingKeywords: true,
    groupPaths: [groupPath],
    groupMetadata: [{ path: groupPath, color: "#22C55E" }],
    rows: [
      {
        sourceRowNumber: "1",
        textOriginal: "SEO",
        textNormalized: "seo",
        normalizedHash: "e".repeat(64),
        language: "ru",
        priority: 80,
        isFavorite: true,
        isTracked: false,
        note: "Импортированная заметка",
        intent: "COMMERCIAL",
        groupPath,
        positions: [
          {
            source: "KEY_COLLECTOR",
            searchEngine: "YANDEX",
            countryCode: "RU",
            regionCode: "213",
            regionLabel: "Москва",
            language: "ru",
            device: "DESKTOP",
            observedAt: "2026-08-02T12:00:00.000Z",
            found: true,
            position: 25,
            previousPosition: 27,
            rankingUrl: "https://example.com/yandex-result",
            serpResults: [
              {
                position: 1,
                rankingUrl: "https://example.com/first",
                title: "Первый результат"
              },
              {
                position: 43,
                rankingUrl: "https://example.com/second"
              }
            ]
          },
          { searchEngine: "GOOGLE", found: false }
        ],
        positionHistory: [{
          source: "KEY_COLLECTOR",
          searchEngine: "YANDEX",
          countryCode: "RU",
          regionCode: "kc4-import",
          regionLabel: "Импорт Key Collector",
          language: "ru",
          device: "DESKTOP",
          observedAt: "2026-08-01T12:00:00.000Z",
          found: true,
          position: 31,
          rankingUrl: "https://example.com/history"
        }],
        customValues: {}
      }
    ]
  });

  assert.deepEqual(result.groupPaths, [groupPath]);
  assert.equal(result.projectDomain, "example.com");
  assert.deepEqual(result.groupMetadata, [{ path: groupPath, color: "#22c55e" }]);
  assert.equal(result.rows[0]?.priority, 80);
  assert.equal(result.rows[0]?.isFavorite, true);
  assert.equal(result.rows[0]?.isTracked, false);
  assert.equal(result.rows[0]?.note, "Импортированная заметка");
  assert.equal(result.rows[0]?.intent, "COMMERCIAL");
  assert.deepEqual(result.rows[0]?.positions, [
    {
      source: "KEY_COLLECTOR",
      searchEngine: "YANDEX",
      countryCode: "RU",
      regionCode: "213",
      regionLabel: "Москва",
      language: "ru",
      device: "DESKTOP",
      observedAt: "2026-08-02T12:00:00.000Z",
      found: true,
      position: 25,
      previousPosition: 27,
      rankingUrl: "https://example.com/yandex-result",
      serpResults: [
        {
          position: 1,
          rankingUrl: "https://example.com/first",
          title: "Первый результат"
        },
        {
          position: 43,
          rankingUrl: "https://example.com/second"
        }
      ]
    },
    { searchEngine: "GOOGLE", found: false }
  ]);
  assert.deepEqual(Object.keys(result.rows[0]!.positions![0]!), [
    "source",
    "countryCode",
    "regionCode",
    "regionLabel",
    "language",
    "device",
    "observedAt",
    "searchEngine",
    "found",
    "position",
    "previousPosition",
    "rankingUrl",
    "serpResults"
  ]);
  assert.equal(result.rows[0]?.positionHistory?.[0]?.source, "KEY_COLLECTOR");
  assert.equal(
    result.rows[0]?.positionHistory?.[0]?.rankingUrl,
    "https://example.com/history"
  );
});

test("rejects invalid imported keyword attributes", () => {
  const row = {
    sourceRowNumber: "1",
    textOriginal: "SEO",
    textNormalized: "seo",
    normalizedHash: "f".repeat(64),
    language: "ru",
    customValues: {}
  };
  for (const invalidAttributes of [
    { priority: 101 },
    { isFavorite: "true" },
    { isTracked: "true" },
    { note: "x".repeat(1_000_001) },
    { intent: "UNKNOWN" }
  ]) {
    assert.throws(
      () =>
        applySemanticImportChunkInput({
          ...context,
          chunkIndex: 0,
          payloadHash: "a".repeat(64),
          duplicatePolicy: "MERGE_NON_EMPTY",
          createMissingKeywords: false,
          rows: [{ ...row, ...invalidAttributes }]
        }),
      BadRequestException
    );
  }
});
