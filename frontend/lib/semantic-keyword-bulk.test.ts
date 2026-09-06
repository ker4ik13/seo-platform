import assert from "node:assert/strict";
import test from "node:test";
import type {
  SemanticKeywordBulkResult,
  SemanticKeywordBulkSelection,
  SemanticKeywordCleaningInput,
  SemanticKeywordCleaningPreview,
  SemanticKeywordCleaningResult
} from "@seo-platform/contracts";
import {
  cleanSemanticKeywordsInBatches,
  previewSemanticKeywordCleaningInBatches,
  updateSemanticKeywordsInBatches
} from "./semantic-keyword-bulk.ts";

const selections: readonly SemanticKeywordBulkSelection[] = Array.from(
  { length: 457 },
  (_, index) => ({ id: `keyword-${index}`, version: index + 1 })
);

test("folder move keeps all selected keywords and sends bounded batches", async () => {
  const batchSizes: number[] = [];
  const result = await updateSemanticKeywordsInBatches(
    "project/with spaces",
    selections,
    { groupId: "target-group" },
    async (projectId, input): Promise<SemanticKeywordBulkResult> => {
      assert.equal(projectId, "project/with spaces");
      assert.deepEqual(input.patch, { groupId: "target-group" });
      batchSizes.push(input.items.length);
      const conflictedIds = input.items.length === 57
        ? [input.items[0]!.id]
        : [];
      return {
        selected: input.items.length,
        changed: input.items.length - conflictedIds.length,
        skipped: 0,
        failed: 0,
        conflicted: conflictedIds.length,
        updatedItems: [],
        conflictedIds,
        skippedIds: [],
        failedIds: []
      };
    }
  );

  assert.deepEqual(batchSizes, [200, 200, 57]);
  assert.equal(result.selected, 457);
  assert.equal(result.changed, 456);
  assert.equal(result.conflicted, 1);
  assert.deepEqual(result.conflictedIds, ["keyword-400"]);
});

test("bulk commands project rich editor rows to exact id and version selections", async () => {
  const richSelections = [{
    id: "keyword-1",
    version: 7,
    text: "SEO аудит",
    language: "ru",
    isTracked: true,
    tags: ["Важно"]
  }];

  await updateSemanticKeywordsInBatches(
    "project-id",
    richSelections,
    { isTracked: false },
    async (_projectId, input): Promise<SemanticKeywordBulkResult> => {
      assert.deepEqual(input, {
        items: [{ id: "keyword-1", version: 7 }],
        patch: { isTracked: false }
      });
      return {
        selected: 1,
        changed: 1,
        skipped: 0,
        failed: 0,
        conflicted: 0,
        updatedItems: [],
        conflictedIds: [],
        skippedIds: [],
        failedIds: []
      };
    }
  );
});

test("cleaning preview and apply aggregate the complete selection", async () => {
  const previewBatchSizes: number[] = [];
  const preview = await previewSemanticKeywordCleaningInBatches(
    "project-id",
    selections,
    { collapseWhitespace: true },
    async (_projectId, input): Promise<SemanticKeywordCleaningPreview> => {
      previewBatchSizes.push(input.items.length);
      return cleaningPreview(input);
    }
  );
  assert.deepEqual(previewBatchSizes, [200, 200, 57]);
  assert.equal(preview.selected, 457);
  assert.equal(preview.applicable, 457);
  assert.equal(preview.changes.length, 457);

  const applyBatchSizes: number[] = [];
  const result = await cleanSemanticKeywordsInBatches(
    "project-id",
    selections,
    { collapseWhitespace: true },
    async (_projectId, input): Promise<SemanticKeywordCleaningResult> => {
      applyBatchSizes.push(input.items.length);
      return cleaningResult(input);
    }
  );
  assert.deepEqual(applyBatchSizes, [200, 200, 57]);
  assert.equal(result.selected, 457);
  assert.equal(result.changed, 457);
  assert.equal(result.failed, 0);
});

test("bulk helpers reject an empty selection before issuing a request", async () => {
  let called = false;
  await assert.rejects(
    updateSemanticKeywordsInBatches(
      "project-id",
      [],
      { groupId: null },
      async (_projectId, _input) => {
        called = true;
        throw new Error("must not run");
      }
    ),
    /At least one semantic keyword/u
  );
  assert.equal(called, false);
});

function cleaningPreview(
  input: SemanticKeywordCleaningInput
): SemanticKeywordCleaningPreview {
  return {
    selected: input.items.length,
    applicable: input.items.length,
    unchanged: 0,
    conflicted: 0,
    failed: 0,
    changes: input.items.map(({ id, version }) => ({
      keywordId: id,
      state: "APPLICABLE",
      expectedVersion: version
    }))
  };
}

function cleaningResult(
  input: SemanticKeywordCleaningInput
): SemanticKeywordCleaningResult {
  return {
    selected: input.items.length,
    changed: input.items.length,
    unchanged: 0,
    conflicted: 0,
    failed: 0,
    updatedItems: [],
    unchangedIds: [],
    conflictedIds: [],
    failedIds: []
  };
}
