import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createSemanticKeywordInput,
  deleteSemanticKeywordInput,
  semanticKeywordBulkCreateInput,
  semanticKeywordBulkCreatePreviewInput,
  semanticKeywordBulkInput,
  semanticKeywordCleaningInput,
  updateSemanticKeywordInput
} from "./keyword-input.js";
import {
  createSemanticKeywordGroupInput,
  createSemanticKeywordGroupsInput,
  deleteSemanticKeywordGroupInput,
  duplicateSemanticKeywordGroupInput,
  updateSemanticKeywordGroupInput
} from "./keyword-group-input.js";

test("parses explicit trash and permanent-delete choices", () => {
  assert.deepEqual(deleteSemanticKeywordInput(undefined), {});
  assert.deepEqual(deleteSemanticKeywordInput({ permanent: true }), {
    permanent: true
  });
  assert.deepEqual(deleteSemanticKeywordGroupInput(undefined), {
    deleteKeywords: false,
    promoteChildren: false
  });
  assert.deepEqual(deleteSemanticKeywordGroupInput({
    deleteKeywords: true,
    promoteChildren: true
  }), {
    deleteKeywords: true,
    promoteChildren: true
  });
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
    isTracked: false,
    intent: "COMMERCIAL",
    targetUrl: "https://EXAMPLE.com:443/audit",
    tagNames: [" Важно ", "важно", "Услуги"]
  });

  assert.equal(input.text, "SEO аудит");
  assert.equal(input.language, "ru");
  assert.equal(input.targetUrl, "https://example.com/audit");
  assert.equal(input.isTracked, false);
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
  assert.equal(result.items[0]?.isTracked, true);
  assert.equal(
    semanticKeywordBulkCreateInput({
      duplicatePolicy: "SKIP_EXISTING",
      items: [
        {
          text: "SEO аудит",
          duplicatePolicy: "ADD_TO_GROUP"
        }
      ]
    }).items[0]?.duplicatePolicy,
    "ADD_TO_GROUP"
  );
  assert.equal(
    semanticKeywordBulkCreateInput({
      duplicatePolicy: "ADD_TO_GROUP",
      items: [{ text: "SEO аудит", groupId: "01900000-0000-7000-8000-000000000010" }]
    }).duplicatePolicy,
    "ADD_TO_GROUP"
  );
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

test("parses a bounded read-only duplicate preview", () => {
  assert.deepEqual(
    semanticKeywordBulkCreatePreviewInput({
      items: [
        {
          text: "  SEO   аудит  ",
          language: "RU",
          groupId: "01900000-0000-7000-8000-000000000010"
        }
      ]
    }),
    {
      items: [
        {
          text: "SEO аудит",
          language: "ru",
          groupId: "01900000-0000-7000-8000-000000000010"
        }
      ]
    }
  );
  assert.throws(
    () =>
      semanticKeywordBulkCreatePreviewInput({
        items: Array.from({ length: 101 }, () => ({ text: "SEO" }))
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

test("accepts only a boolean AI-answer shortcut preference", () => {
  assert.deepEqual(
    updateSemanticKeywordInput({ showAiAnswerButton: true }),
    { showAiAnswerButton: true }
  );
  assert.throws(
    () => updateSemanticKeywordInput({ showAiAnswerButton: "yes" }),
    DomainError
  );
});

test("parses explicit keyword tracking choices", () => {
  assert.equal(
    createSemanticKeywordInput({ text: "SEO аудит" }).isTracked,
    true
  );
  assert.deepEqual(updateSemanticKeywordInput({ isTracked: false }), {
    isTracked: false
  });
  assert.throws(
    () => updateSemanticKeywordInput({ isTracked: "yes" }),
    DomainError
  );
});

test("normalizes keyword notes and supports an explicit removal", () => {
  assert.deepEqual(updateSemanticKeywordInput({ note: "  Гипотеза по кластеру  " }), {
    note: "Гипотеза по кластеру"
  });
  assert.deepEqual(updateSemanticKeywordInput({ note: null }), { note: null });
  assert.equal(
    updateSemanticKeywordInput({ note: "x".repeat(120_000) }).note?.length,
    120_000
  );
});

test("normalizes nested group create and nullable update", () => {
  const parentId = "01900000-0000-7000-8000-000000000010";
  assert.deepEqual(
    createSemanticKeywordGroupInput({
      name: "  Услуги  ",
      parentId,
      color: "#AABBCC",
      position: 4
    }),
    { name: "Услуги", parentId, color: "#aabbcc", position: 4 }
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
  assert.deepEqual(
    createSemanticKeywordGroupsInput({
      names: ["  Москва  ", " Санкт-Петербург "],
      parentId,
      color: "#AABBCC",
      position: 4
    }),
    {
      names: ["Москва", "Санкт-Петербург"],
      parentId,
      color: "#aabbcc",
      position: 4
    }
  );
  assert.throws(
    () => createSemanticKeywordGroupsInput({ names: ["SEO", "seo"] }),
    DomainError
  );
  assert.throws(
    () =>
      createSemanticKeywordGroupsInput({
        names: Array.from({ length: 201 }, (_, index) => `Папка ${index}`)
      }),
    DomainError
  );
  assert.throws(
    () => updateSemanticKeywordGroupInput({ name: "SEO", position: -1 }),
    DomainError
  );
  assert.deepEqual(
    duplicateSemanticKeywordGroupInput({
      name: "  Услуги — копия  ",
      parentId,
      color: "#AABBCC",
      includeDescendants: true,
      includeKeywords: false
    }),
    {
      name: "Услуги — копия",
      parentId,
      color: "#aabbcc",
      includeDescendants: true,
      includeKeywords: false
    }
  );
  assert.throws(
    () =>
      duplicateSemanticKeywordGroupInput({
        name: "SEO",
        includeDescendants: "yes",
        includeKeywords: true
      }),
    DomainError
  );
});

test("requires exact versions for every bounded bulk selection", () => {
  const id = "01900000-0000-7000-8000-000000000020";
  const clusterId = "01900000-0000-7000-8000-000000000021";
  assert.deepEqual(
    semanticKeywordBulkInput({
      items: [{ id, version: 3 }],
      patch: {
        isFavorite: true,
        isTracked: false,
        intent: null,
        clusterId,
        tagNames: []
      }
    }),
    {
      items: [{ id, version: 3 }],
      patch: {
        isFavorite: true,
        isTracked: false,
        intent: null,
        clusterId,
        tagNames: []
      }
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
test("tag deltas are exact and bulk additions cannot implicitly remove other tags", () => {
  const id = "01900000-0000-7000-8000-000000000001";
  assert.deepEqual(updateSemanticKeywordInput({ addTagNames: ["  Новый  ", "новый"], removeTagNames: ["Старый, особый"] }), { addTagNames: ["новый"], removeTagNames: ["Старый, особый"] });
  assert.deepEqual(semanticKeywordBulkInput({ items: [{ id, version: 1 }], patch: { addTagNames: ["Спрос, бренд"] } }).patch, { addTagNames: ["Спрос, бренд"] });
  for (const patch of [{ tagNames: [], addTagNames: ["A"] }, { addTagNames: ["A"], removeTagNames: ["a"] }]) assert.throws(() => updateSemanticKeywordInput(patch));
  assert.throws(() => semanticKeywordBulkInput({ items: [{ id, version: 1 }], patch: { tagNames: [], addTagNames: ["A"] } }));
  assert.deepEqual(semanticKeywordBulkInput({ items: [{ id, version: 1 }], patch: { addTagNames: ["Новый"], removeTagNames: [" A ", "a"] } }).patch, { addTagNames: ["Новый"], removeTagNames: ["a"] });
  assert.throws(() => semanticKeywordBulkInput({ items: [{ id, version: 1 }], patch: { addTagNames: ["A"], removeTagNames: ["a"] } }));
  assert.throws(() => semanticKeywordBulkInput({ items: [{ id, version: 1 }], patch: { tagNames: [], removeTagNames: ["A"] } }));
  assert.throws(() => updateSemanticKeywordInput({ addTagNames: ["a".repeat(161)] }));
});
