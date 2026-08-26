import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { SemanticImportPublishRow } from "@seo-platform/contracts";
import {
  keywordResearchImportGroupPath,
  keywordResearchImportPayloadHash,
  keywordResearchImportTags
} from "./keyword-research-import.service.js";

test("hashes Wordstat import rows in the SEO data canonical field order", () => {
  const row: SemanticImportPublishRow = {
    sourceRowNumber: "1",
    textOriginal: "нейросети",
    textNormalized: "нейросети",
    normalizedHash: "a".repeat(64),
    language: "ru",
    frequencies: [{ type: "BASE", value: "4360445" }],
    groupPath: ["Wordstat", "Нейросети"],
    customValues: { "Wordstat исходный запрос": "нейросети" }
  };
  const canonical = [{
    sourceRowNumber: row.sourceRowNumber,
    textOriginal: row.textOriginal,
    textNormalized: row.textNormalized,
    normalizedHash: row.normalizedHash,
    language: row.language,
    groupPath: row.groupPath,
    frequencies: row.frequencies,
    tags: row.tags,
    customValues: row.customValues
  }];

  assert.equal(
    keywordResearchImportPayloadHash([row]),
    createHash("sha256")
      .update(JSON.stringify(canonical), "utf8")
      .digest("hex")
  );
});

test("does not attach provider tags to parsed Wordstat keywords", () => {
  assert.equal(keywordResearchImportTags("XMLSTOCK_WORDSTAT"), undefined);
  assert.equal(keywordResearchImportTags("ARSENKIN_WORDSTAT"), undefined);
});

test("keeps source tags for the separate Keys.so research import", () => {
  assert.deepEqual(
    keywordResearchImportTags("KEYS_SO", "example.ru"),
    ["Keys.so", "example.ru"]
  );
});

test("uses a row-specific Wordstat destination as a semantic group path", () => {
  assert.deepEqual(
    keywordResearchImportGroupPath({
      rowTargetGroupPath: "Wordstat / Коммерческие / Москва",
      runTargetGroupPath: "Wordstat / Остальные",
      distributionMode: "BY_SOURCE_QUERY",
      sourceQuery: "купить холодильник"
    }),
    ["Wordstat", "Коммерческие", "Москва"]
  );
});

test("can distribute Wordstat rows into folders named after their source query", () => {
  assert.deepEqual(
    keywordResearchImportGroupPath({
      rowTargetGroupPath: null,
      runTargetGroupPath: "Wordstat / Август",
      distributionMode: "BY_SOURCE_QUERY",
      sourceQuery: "  купить / холодильник  "
    }),
    ["Wordstat", "Август", "купить ∕ холодильник"]
  );
});

test("rejects an unsafe stored Wordstat destination", () => {
  assert.throws(() => keywordResearchImportGroupPath({
    rowTargetGroupPath: "Wordstat /  / Москва",
    runTargetGroupPath: null,
    distributionMode: "SINGLE_GROUP",
    sourceQuery: null
  }));
});
