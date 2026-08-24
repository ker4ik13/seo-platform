import assert from "node:assert/strict";
import test from "node:test";
import { semanticKeywordGroupBulkCreateMaxItems } from "@seo-platform/contracts";
import {
  normalizeSemanticGroupName,
  prepareSemanticGroupNames,
  semanticGroupNameLineCount,
  semanticGroupNamesFromText
} from "./semantic-group-name-batch.ts";

test("normalizes and preserves the entered semantic group order", () => {
  assert.deepEqual(
    prepareSemanticGroupNames(["  Москва  ", "Санкт‑Петербург", " Юг "]),
    ["Москва", "Санкт‐Петербург", "Юг"]
  );
});

test("rejects duplicate, existing, invalid and oversized group batches", () => {
  assert.throws(
    () => prepareSemanticGroupNames(["SEO", "seo"]),
    /уже добавлена/u
  );
  assert.throws(
    () => prepareSemanticGroupNames(["SEO"], ["seo"]),
    /уже существует/u
  );
  assert.throws(() => normalizeSemanticGroupName("SEO / PPC"), /символ/u);
  assert.throws(
    () =>
      prepareSemanticGroupNames(
        Array.from(
          { length: semanticKeywordGroupBulkCreateMaxItems + 1 },
          (_, index) => `Папка ${index}`
        )
      ),
    /до 200/u
  );
});

test("parses a plain-text folder list with one name per non-empty line", () => {
  const value = "  Москва  \n\nСанкт-Петербург\r\n Омск \rКазань\n";

  assert.deepEqual(semanticGroupNamesFromText(value), [
    "Москва",
    "Санкт-Петербург",
    "Омск",
    "Казань"
  ]);
  assert.equal(semanticGroupNameLineCount(value), 4);
});

test("validates duplicate and oversized names parsed from text", () => {
  assert.throws(
    () => semanticGroupNamesFromText("SEO\nseo"),
    /уже добавлена/u
  );
  assert.throws(
    () =>
      semanticGroupNamesFromText(
        Array.from(
          { length: semanticKeywordGroupBulkCreateMaxItems + 1 },
          (_, index) => `Папка ${index}`
        ).join("\n")
      ),
    /до 200/u
  );
});
