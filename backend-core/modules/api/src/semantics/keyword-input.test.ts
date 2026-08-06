import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createSemanticKeywordInput,
  deleteSemanticKeywordInput,
  semanticKeywordBulkCreateInput,
  semanticKeywordBulkInput,
  semanticKeywordCleaningInput,
  updateSemanticKeywordInput
} from "./keyword-input.js";
import {
  createSemanticKeywordGroupInput,
  deleteSemanticKeywordGroupInput,
  updateSemanticKeywordGroupInput
} from "./keyword-group-input.js";

test("parses explicit trash and permanent-delete choices", () => {
  assert.deepEqual(deleteSemanticKeywordInput(undefined), {});
  assert.deepEqual(deleteSemanticKeywordInput({ permanent: true }), {
    permanent: true
  });
  assert.deepEqual(deleteSemanticKeywordGroupInput(undefined), {
    deleteKeywords: false
  });
  assert.deepEqual(
    deleteSemanticKeywordGroupInput({ deleteKeywords: true }),
    { deleteKeywords: true }
  );
  assert.throws(
    () => deleteSemanticKeywordGroupInput({ deleteKeywords: "yes" }),
    DomainError
  );

});

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
  assert.equal(input.duplicatePolicy, "REJECT_EXISTING");
  assert.deepEqual(input.tagNames, ["важно", "Услуги"]);
});

test("parses a bounded keyword bulk create with an explicit duplicate policy", () => {
  const result = semanticKeywordBulkCreateInput({
    duplicatePolicy: "SKIP_EXISTING",
    items: [
      { text: "  SEO   аудит  ", language: "RU" },
      { text: "SEO аудит", language: "ru" }
    ]
  });

  assert.equal(result.duplicatePolicy, "SKIP_EXISTING");
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.text, "SEO аудит");
  assert.equal(result.items[0]?.language, "ru");
  assert.equal(result.items[0]?.priority, 0);
  assert.throws(
    () =>
      semanticKeywordBulkCreateInput({
        items: [{ text: "SEO" }]
      }),
    DomainError
  );
  const largeTags = Array.from(
    { length: 50 },
    (_, index) => `${String(index).padStart(2, "0")}${"x".repeat(158)}`
  );
  assert.throws(
    () =>
      semanticKeywordBulkCreateInput({
        duplicatePolicy: "SKIP_EXISTING",
        items: Array.from({ length: 820 }, (_, index) => ({
          text: `keyword ${index}`,
          tagNames: largeTags
        }))
      }),
    DomainError
  );
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

test("normalizes keyword notes and supports an explicit removal", () => {
  assert.deepEqual(updateSemanticKeywordInput({ note: "  Гипотеза по кластеру  " }), {
    note: "Гипотеза по кластеру"
  });
  assert.deepEqual(updateSemanticKeywordInput({ note: null }), { note: null });
  assert.throws(() => updateSemanticKeywordInput({ note: "x".repeat(4_001) }), DomainError);
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
      color: null,
      position: 3
    }),
    { name: "SEO", parentId: null, color: null, position: 3 }
  );
  assert.throws(
    () => createSemanticKeywordGroupInput({ name: "SEO / PPC" }),
    DomainError
  );
  assert.throws(
    () => updateSemanticKeywordGroupInput({ name: "SEO", position: -1 }),
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
