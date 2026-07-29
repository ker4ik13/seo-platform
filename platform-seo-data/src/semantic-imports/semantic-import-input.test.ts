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
      expectedUniqueRows: "500"
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
