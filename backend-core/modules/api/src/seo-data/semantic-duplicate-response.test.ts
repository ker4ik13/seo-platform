import assert from "node:assert/strict";
import test from "node:test";
import {
  semanticDuplicateApplyResult,
  semanticDuplicatePreview
} from "./seo-data.client.js";

const keeperId = "11111111-1111-4111-8111-111111111111";
const duplicateId = "22222222-2222-4222-8222-222222222222";

test("accepts a bounded implicit-duplicate preview and apply result", () => {
  const preview = semanticDuplicatePreview({
    scannedCount: 2_002,
    duplicateGroupCount: 1,
    duplicateKeywordCount: 2,
    deletionCount: 1,
    batchItems: [{ id: duplicateId, version: 3 }],
    hasMore: false,
    previewHash: "a".repeat(64),
    groups: [{
      id: "b".repeat(64),
      keeperKeywordId: keeperId,
      items: [
        {
          keywordId: keeperId,
          text: "цветная капуста",
          version: 1,
          groupPaths: ["Каталог / Овощи"],
          priority: 10,
          baseFrequency: "2500",
          keep: true
        },
        {
          keywordId: duplicateId,
          text: "капуста цветная",
          version: 3,
          groupPaths: ["Каталог / Овощи"],
          priority: 5,
          keep: false
        }
      ],
      itemsTruncated: false
    }],
    groupsTruncated: false
  });
  assert.equal(preview.scannedCount, 2_002);
  assert.equal(preview.groups[0]?.keeperKeywordId, keeperId);

  assert.deepEqual(semanticDuplicateApplyResult({
    deletedCount: 1,
    deletedKeywordIds: [duplicateId],
    hasMore: false
  }), {
    deletedCount: 1,
    deletedKeywordIds: [duplicateId],
    hasMore: false
  });
});

test("rejects contradictory and duplicate internal projections", () => {
  assert.throws(() => semanticDuplicatePreview({
    scannedCount: 2,
    duplicateGroupCount: 0,
    duplicateKeywordCount: 0,
    deletionCount: 1,
    batchItems: [{ id: duplicateId, version: 1 }],
    hasMore: true,
    previewHash: "a".repeat(64),
    groups: [],
    groupsTruncated: false
  }));
  assert.throws(() => semanticDuplicateApplyResult({
    deletedCount: 2,
    deletedKeywordIds: [duplicateId, duplicateId],
    hasMore: false
  }));
});
