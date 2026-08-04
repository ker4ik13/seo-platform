import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_KEYWORD_LIMIT,
  cleanPublicKeywords,
  normalizePublicKeyword,
  snippetLengthState
} from "./public-tools.ts";

test("normalizes whitespace, typography and Unicode form", () => {
  assert.equal(
    normalizePublicKeyword("  купить\t«SEO—сервис»  "),
    'купить "SEO-сервис"'
  );
});

test("removes case-insensitive duplicates and reports discarded rows", () => {
  assert.deepEqual(cleanPublicKeywords("SEO tools\nseo tools\n\nSERP"), {
    keywords: ["SEO tools", "SERP"],
    sourceRows: 4,
    emptyRows: 1,
    duplicateRows: 1,
    truncatedRows: 0
  });
});

test("enforces the public hard row limit", () => {
  const result = cleanPublicKeywords(
    Array.from({ length: PUBLIC_KEYWORD_LIMIT + 2 }, (_, index) => `q${index}`).join("\n")
  );
  assert.equal(result.keywords.length, PUBLIC_KEYWORD_LIMIT);
  assert.equal(result.truncatedRows, 2);
});

test("classifies snippet lengths", () => {
  assert.equal(snippetLengthState("", 60), "EMPTY");
  assert.equal(snippetLengthState("Title", 60), "OK");
  assert.equal(snippetLengthState("x".repeat(61), 60), "LONG");
});
