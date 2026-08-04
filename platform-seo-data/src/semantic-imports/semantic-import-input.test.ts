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
      expectedChunks: 2,
      expectedUniqueRows: "500",
      expectedNewKeywords: "450",
      entitlement
    }).expectedChunks,
    2
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
    groupPaths: [groupPath],
    rows: [
      {
        sourceRowNumber: "1",
        textOriginal: "SEO",
        textNormalized: "seo",
        normalizedHash: "e".repeat(64),
        language: "ru",
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
