import assert from "node:assert/strict";
import test from "node:test";
import {
  internalApplySemanticDuplicatesInput,
  internalSemanticDuplicateCommandInput
} from "./semantic-duplicate-input.js";

const ids = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  actorId: "33333333-3333-4333-8333-333333333333"
};

test("accepts a trusted tenant-scoped implicit-duplicate command", () => {
  const result = internalSemanticDuplicateCommandInput({
    ...ids,
    rules: {
      analysisMode: "EXACT",
      caseSensitive: false,
      ignorePunctuation: true,
      ignoredWords: []
    },
    scope: { kind: "PROJECT" },
    keeperStrategy: "HIGHEST_PRIORITY",
    page: 3,
    pageSize: 100
  });
  assert.equal(result.projectId, ids.projectId);
  assert.equal(result.keeperStrategy, "HIGHEST_PRIORITY");
  assert.equal(result.page, 3);
});

test("rejects duplicate selections and malformed preview hashes", () => {
  const selection = {
    ...ids,
    rules: {
      analysisMode: "EXACT",
      caseSensitive: false,
      ignorePunctuation: true,
      ignoredWords: []
    },
    scope: {
      kind: "SELECTION",
      items: [
        { id: ids.actorId, version: 1 },
        { id: ids.actorId, version: 1 }
      ]
    },
    keeperStrategy: "OLDEST"
  };
  assert.throws(() => internalSemanticDuplicateCommandInput(selection));
  assert.throws(() => internalSemanticDuplicateCommandInput({
    ...selection,
    scope: { kind: "PROJECT" },
    page: 1,
    pageSize: "100"
  }));
  assert.throws(() => internalApplySemanticDuplicatesInput({
    ...selection,
    scope: { kind: "PROJECT" },
    previewHash: "invalid"
  }));
});

test("accepts bounded tenant-scoped manual duplicate decisions", () => {
  const result = internalApplySemanticDuplicatesInput({
    ...ids,
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
      keeper: { id: ids.actorId, version: 1 },
      deletions: [{ id: ids.workspaceId, version: 2 }]
    }]
  });
  assert.equal(result.decisions[0]?.deletions[0]?.version, 2);
});
