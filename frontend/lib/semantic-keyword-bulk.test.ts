import assert from "node:assert/strict";
import test from "node:test";
import type {
  SemanticKeywordBulkResult,
  SemanticKeywordBulkSelection,
  SemanticKeywordCleaningInput,
  SemanticKeywordCleaningPreview,
  SemanticKeywordCleaningResult,
  SemanticKeywordListItem
} from "@seo-platform/contracts";
import {
  cleanSemanticKeywordsInBatches,
  previewSemanticKeywordCleaningInBatches,
  reconcileSemanticKeywordMove,
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

test("folder move merges returned rows without losing loaded metrics", () => {
  const current = {
    ...keyword("keyword-1", "group-old", "Старая", 4),
    groupMembershipCount: 2,
    frequencies: [{
      type: "BASE" as const,
      value: "120",
      regionCode: "213",
      device: "ALL" as const,
      provider: "XMLSTOCK",
      observedAt: "2026-09-10T10:00:00.000Z"
    }]
  };
  const updated = keyword("keyword-1", "group-new", "Новая", 5);

  const result = reconcileSemanticKeywordMove([current], [updated], []);

  assert.deepEqual(result.updatedIds, ["keyword-1"]);
  assert.deepEqual(result.removedIds, []);
  assert.equal(result.items[0]?.groupId, "group-new");
  assert.equal(result.items[0]?.groupPath, "Новая");
  assert.equal(result.items[0]?.version, 5);
  assert.equal(result.items[0]?.groupMembershipCount, undefined);
  assert.deepEqual(result.items[0]?.frequencies, current.frequencies);
});

test("folder move removes only changed rows that left the visible group", () => {
  const moved = keyword("keyword-1", "group-old", "Старая", 4);
  const conflicted = keyword("keyword-2", "group-old", "Старая", 8);
  const updated = keyword("keyword-1", "group-new", "Новая", 5);

  const result = reconcileSemanticKeywordMove(
    [moved, conflicted],
    [updated],
    ["group-old"]
  );

  assert.deepEqual(result.items.map(({ id }) => id), ["keyword-2"]);
  assert.deepEqual(result.updatedIds, ["keyword-1"]);
  assert.deepEqual(result.removedIds, ["keyword-1"]);
  assert.equal(result.items[0]?.version, 8);
});

test("folder move preserves every already loaded cursor page", () => {
  const current = Array.from({ length: 501 }, (_, index) =>
    keyword(`keyword-${index}`, "group-old", "Старая", index + 1)
  );
  const updated = keyword("keyword-500", "group-new", "Новая", 502);

  const result = reconcileSemanticKeywordMove(current, [updated], []);

  assert.equal(result.items.length, 501);
  assert.equal(result.items[0]?.id, "keyword-0");
  assert.equal(result.items[500]?.id, "keyword-500");
  assert.equal(result.items[500]?.groupId, "group-new");
  assert.equal(result.items[500]?.version, 502);
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

function keyword(
  id: string,
  groupId: string,
  groupPath: string,
  version: number
): SemanticKeywordListItem {
  return {
    id,
    textOriginal: id,
    textNormalized: id,
    language: "ru",
    priority: 0,
    isFavorite: false,
    isTracked: true,
    showAiAnswerButton: false,
    groupId,
    groupPath,
    tags: [],
    tagsTruncated: false,
    sourceMode: "MANUAL",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-10T10:00:00.000Z",
    version
  };
}

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
