import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { createSemanticExportInput } from "./semantic-export-input.js";

const keywordId = "01900000-0000-7000-8000-000000000010";
const groupId = "01900000-0000-7000-8000-000000000020";

test("accepts a bounded filtered semantic export", () => {
  assert.deepEqual(
    createSemanticExportInput({
      format: "CSV",
      scope: "CURRENT_FILTER",
      locale: "ru",
      columns: ["query", "group", `custom:${keywordId}`],
      filters: {
        search: "  SEO аудит ",
        groupId,
        isTracked: true,
        priorityMin: 10
      },
      sort: "TEXT_ASC",
      includeBom: true
    }),
    {
      format: "CSV",
      scope: "CURRENT_FILTER",
      locale: "ru",
      columns: ["query", "group", `custom:${keywordId}`],
      filters: {
        search: "SEO аудит",
        groupId,
        isTracked: true,
        priorityMin: 10
      },
      sort: "TEXT_ASC",
      includeBom: true
    }
  );
});

test("requires scope-specific IDs and rejects ambiguous full exports", () => {
  assert.throws(
    () =>
      createSemanticExportInput({
        format: "JSON",
        scope: "SELECTED",
        locale: "en",
        columns: ["query"]
      }),
    DomainError
  );
  assert.throws(
    () =>
      createSemanticExportInput({
        format: "JSON",
        scope: "FULL_CORE",
        locale: "en",
        columns: ["query"],
        filters: {}
      }),
    DomainError
  );
  assert.throws(
    () =>
      createSemanticExportInput({
        format: "JSON",
        scope: "CURRENT_PAGE",
        locale: "en",
        columns: ["query"],
        keywordIds: [keywordId, keywordId]
      }),
    DomainError
  );
});
