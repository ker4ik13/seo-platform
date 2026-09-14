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
            searchEngine: "YANDEX",
            found: true,
            position: 25,
            previousPosition: 27,
            rankingUrl: "https://example.com/yandex-result"
          },
          { searchEngine: "GOOGLE", found: false }
        ],
        customValues: {}
      }
    ]
  });

  assert.deepEqual(result.groupPaths, [groupPath]);
  assert.deepEqual(result.groupMetadata, [{ path: groupPath, color: "#22c55e" }]);
  assert.equal(result.rows[0]?.priority, 80);
  assert.equal(result.rows[0]?.isFavorite, true);
  assert.equal(result.rows[0]?.isTracked, false);
  assert.equal(result.rows[0]?.note, "Импортированная заметка");
  assert.equal(result.rows[0]?.intent, "COMMERCIAL");
  assert.deepEqual(result.rows[0]?.positions, [
    {
      searchEngine: "YANDEX",
      found: true,
      position: 25,
      previousPosition: 27,
      rankingUrl: "https://example.com/yandex-result"
    },
    { searchEngine: "GOOGLE", found: false }
  ]);
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
