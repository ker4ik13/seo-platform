import assert from "node:assert/strict";
import test from "node:test";
import {
  applySemanticDuplicatesInput,
  semanticDuplicateCommandInput
} from "./semantic-duplicate-input.js";

const keywordId = "11111111-1111-4111-8111-111111111111";
const duplicateId = "22222222-2222-4222-8222-222222222222";

test("normalizes a precise implicit-duplicate preview command", () => {
  assert.deepEqual(
    semanticDuplicateCommandInput({
      rules: {
        analysisMode: "WORD_FORM_PRECISE",
        caseSensitive: false,
        ignorePunctuation: true,
        ignoredWords: ["  в  ", "В", "на"]
      },
      scope: { kind: "SELECTION", items: [{ id: keywordId, version: 2 }] },
      keeperStrategy: "HIGHEST_FREQUENCY",
      page: 2,
      pageSize: 100
    }),
    {
      rules: {
        analysisMode: "WORD_FORM_PRECISE",
        caseSensitive: false,
        ignorePunctuation: true,
        ignoredWords: ["в", "на"]
      },
      scope: { kind: "SELECTION", items: [{ id: keywordId, version: 2 }] },
      keeperStrategy: "HIGHEST_FREQUENCY",
      page: 2,
      pageSize: 100
    }
  );
});

test("rejects unsupported fields and an invalid apply hash", () => {
  assert.throws(() => semanticDuplicateCommandInput({
    rules: {
      analysisMode: "EXACT",
      caseSensitive: false,
      ignorePunctuation: true,
      ignoredWords: []
    },
    scope: { kind: "PROJECT" },
    keeperStrategy: "OLDEST",
    removeImmediately: true
  }));
  assert.throws(() => semanticDuplicateCommandInput({
    rules: {
      analysisMode: "EXACT",
      caseSensitive: false,
      ignorePunctuation: true,
      ignoredWords: []
    },
    scope: { kind: "PROJECT" },
    keeperStrategy: "OLDEST",
    page: 1,
    pageSize: 200
  }));
  assert.throws(() => semanticDuplicateCommandInput({
    rules: {
      analysisMode: "EXACT",
      caseSensitive: false,
      ignorePunctuation: true,
      ignoredWords: []
    },
    scope: { kind: "PROJECT" },
    keeperStrategy: "OLDEST",
    page: "1",
    pageSize: 100
  }));
  assert.throws(() => applySemanticDuplicatesInput({
    rules: {
      analysisMode: "EXACT",
      caseSensitive: false,
      ignorePunctuation: true,
      ignoredWords: []
    },
    scope: { kind: "PROJECT" },
    keeperStrategy: "OLDEST",
    previewHash: "stale"
  }));
});

test("accepts only an explicit partition of reviewed duplicate groups", () => {
  const input = applySemanticDuplicatesInput({
    rules: {
      analysisMode: "EXACT",
      caseSensitive: false,
      ignorePunctuation: true,
      ignoredWords: []
    },
    scope: { kind: "PROJECT" },
    keeperStrategy: "OLDEST",
    previewHash: "a".repeat(64),
    decisions: [{
      groupId: "b".repeat(64),
      keeper: { id: keywordId, version: 2 },
      deletions: [{ id: duplicateId, version: 3 }]
    }]
  });
  assert.equal(input.decisions[0]?.keeper.id, keywordId);
  assert.deepEqual(input.decisions[0]?.deletions, [
    { id: duplicateId, version: 3 }
  ]);

  assert.throws(() => applySemanticDuplicatesInput({
    ...input,
    decisions: [{
      groupId: "b".repeat(64),
      keeper: { id: keywordId, version: 2 },
      deletions: [{ id: keywordId, version: 2 }]
    }]
  }));
});
