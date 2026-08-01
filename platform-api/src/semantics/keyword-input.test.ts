import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createSemanticKeywordInput,
  semanticKeywordBulkInput,
  semanticKeywordCleaningInput,
  updateSemanticKeywordInput
} from "./keyword-input.js";
import {
  createSemanticKeywordGroupInput,
  updateSemanticKeywordGroupInput
} from "./keyword-group-input.js";

test("normalizes a complete manual semantic keyword", () => {
  const input = createSemanticKeywordInput({
    text: "  SEO   аудит  ",
    language: "ru",
    priority: 10,
    isFavorite: true,
    intent: "COMMERCIAL",
    targetUrl: "https://EXAMPLE.com:443/audit",
    tagNames: [" Важно ", "важно", "Услуги"]
  });

  assert.equal(input.text, "SEO аудит");
  assert.equal(input.language, "ru");
  assert.equal(input.targetUrl, "https://example.com/audit");
  assert.deepEqual(input.tagNames, ["важно", "Услуги"]);
});

test("requires an explicit non-empty keyword patch", () => {
  assert.throws(() => updateSemanticKeywordInput({}), DomainError);
  assert.throws(
    () => createSemanticKeywordInput({ text: "=x", language: "bad_tag" }),
    DomainError
  );
  assert.throws(
    () =>
      createSemanticKeywordInput({
        text: "x",
        language: "ru",
        targetUrl: "https://user:password@example.com"
      }),
    DomainError
  );
});

test("normalizes nested group create and nullable update", () => {
  const parentId = "01900000-0000-7000-8000-000000000010";
  assert.deepEqual(
    createSemanticKeywordGroupInput({
      name: "  Услуги  ",
      parentId,
      color: "#AABBCC"
    }),
    { name: "Услуги", parentId, color: "#aabbcc" }
  );
  assert.deepEqual(
    updateSemanticKeywordGroupInput({
      name: "SEO",
      parentId: null,
      color: null
    }),
    { name: "SEO", parentId: null, color: null }
  );
  assert.throws(
    () => createSemanticKeywordGroupInput({ name: "SEO / PPC" }),
    DomainError
  );
});

test("requires exact versions for every bounded bulk selection", () => {
  const id = "01900000-0000-7000-8000-000000000020";
  const clusterId = "01900000-0000-7000-8000-000000000021";
  assert.deepEqual(
    semanticKeywordBulkInput({
      items: [{ id, version: 3 }],
      patch: { isFavorite: true, intent: null, clusterId, tagNames: [] }
    }),
    {
      items: [{ id, version: 3 }],
      patch: { isFavorite: true, intent: null, clusterId, tagNames: [] }
    }
  );
  assert.throws(
    () =>
      semanticKeywordBulkInput({
        items: [
          { id, version: 1 },
          { id, version: 2 }
        ],
        patch: { priority: 1 }
      }),
    DomainError
  );
  assert.throws(
    () => semanticKeywordBulkInput({ items: [{ id, version: 1 }], patch: {} }),
    DomainError
  );
});

test("accepts only explicit non-empty keyword cleaning rules", () => {
  const id = "01900000-0000-7000-8000-000000000030";
  assert.deepEqual(
    semanticKeywordCleaningInput({
      items: [{ id, version: 2 }],
      rules: {
        collapseWhitespace: true,
        normalizeYo: false,
        letterCase: "LOWER"
      }
    }),
    {
      items: [{ id, version: 2 }],
      rules: {
        collapseWhitespace: true,
        normalizeYo: false,
        letterCase: "LOWER"
      }
    }
  );
  assert.throws(
    () =>
      semanticKeywordCleaningInput({
        items: [{ id, version: 2 }],
        rules: { collapseWhitespace: false, letterCase: "KEEP" }
      }),
    DomainError
  );
  assert.throws(
    () =>
      semanticKeywordCleaningInput({
        items: [{ id, version: 2 }],
        rules: { unsafeRegex: ".*" }
      }),
    DomainError
  );
});
