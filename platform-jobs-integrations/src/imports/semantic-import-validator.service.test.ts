import assert from "node:assert/strict";
import test from "node:test";
import type { SemanticImportMapping } from "@seo-platform/contracts";
import { canonicalImportRow } from "./semantic-import-validator.service.js";

const mapping: SemanticImportMapping = {
  columns: [
    { sourceIndex: 0, target: "keyword.text" },
    { sourceIndex: 1, target: "group.path" },
    { sourceIndex: 2, target: "page.target_url" },
    { sourceIndex: 3, target: "frequency.exact" },
    { sourceIndex: 4, target: "keyword.tags" },
    { sourceIndex: 5, target: "ranking.position" },
    { sourceIndex: 6, target: "custom", customName: "Score" }
  ],
  defaultLanguage: "ru",
  groupSeparator: ">",
  duplicatePolicy: "SKIP_EXISTING"
};

test("builds a canonical publish row without losing unsupported values", () => {
  const issues = new Set<string>();
  const result = canonicalImportRow(
    2n,
    [
      "SEO",
      "Маркетинг > SEO",
      "https://example.com/seo",
      "1 200",
      "важное;продажи",
      "7",
      "42"
    ],
    [
      "Фраза",
      "Группа",
      "URL",
      "Точная частотность",
      "Теги",
      "Позиция",
      "Score"
    ],
    mapping,
    {
      textOriginal: "SEO",
      textNormalized: "seo",
      normalizedHash: "a".repeat(64),
      language: "ru"
    },
    issues
  );

  assert.deepEqual(result.groupPath, ["Маркетинг", "SEO"]);
  assert.deepEqual(result.frequencies, [{ type: "EXACT", value: "1200" }]);
  assert.deepEqual(result.tags, ["важное", "продажи"]);
  assert.equal(result.customValues.Score, "42");
  assert.equal(result.customValues["Imported: Позиция"], "7");
  assert.deepEqual([...issues], ["TRACKING_CONTEXT_REQUIRED"]);
});

test("keeps a valid keyword while reporting invalid optional values", () => {
  const issues = new Set<string>();
  const result = canonicalImportRow(
    3n,
    ["SEO", "", "javascript:alert(1)", "not-a-number"],
    ["Фраза", "Группа", "URL", "Точная частотность"],
    {
      ...mapping,
      columns: mapping.columns.slice(0, 4)
    },
    {
      textOriginal: "SEO",
      textNormalized: "seo",
      normalizedHash: "a".repeat(64),
      language: "ru"
    },
    issues
  );

  assert.equal(result.targetUrl, undefined);
  assert.equal(result.frequencies, undefined);
  assert.deepEqual(
    new Set(issues),
    new Set(["INVALID_TARGET_URL", "INVALID_FREQUENCY"])
  );
});
