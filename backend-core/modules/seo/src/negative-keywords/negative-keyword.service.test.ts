import assert from "node:assert/strict";
import test from "node:test";
import {
  NegativeKeywordService,
  negativeKeywordDeletionPlan
} from "./negative-keyword.service.js";

const context = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003"
};

test("negative keyword preview exposes every match through 100-row pages", async () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({
    id: keywordId(index),
    textOriginal: `купить слона номер ${index + 1}`,
    version: 1
  }));
  const service = new NegativeKeywordService({
    keyword: { findMany: async () => rows }
  } as never, {} as never);
  const command = {
    ...context,
    rules: {
      words: ["слон"],
      matchMode: "WORD_FORM_PRECISE" as const,
      caseSensitive: false,
      ignoreWordOrder: false,
      ignorePunctuation: false
    },
    scope: { kind: "PROJECT" as const },
    pageSize: 100 as const
  };

  const firstPage = await service.preview({ ...command, page: 1 });
  const secondPage = await service.preview({ ...command, page: 2 });
  const lastPage = await service.preview({ ...command, page: 3 });

  assert.equal(secondPage.scannedCount, 205);
  assert.equal(secondPage.matchedCount, 205);
  assert.equal(secondPage.batchCount, 205);
  assert.equal(secondPage.hasMore, false);
  assert.equal(secondPage.pageCount, 3);
  assert.equal(secondPage.matches.length, 100);
  assert.equal(lastPage.matches.length, 5);
  assert.equal(firstPage.previewHash, secondPage.previewHash);
  assert.deepEqual(secondPage.matches[0]?.highlightRanges, [{ start: 7, end: 12 }]);
});

test("unchecked matches are skipped without starving later selected rows", () => {
  const matches = Array.from({ length: 700 }, (_, index) => ({
    keywordId: keywordId(index),
    text: `запрос ${index + 1}`,
    version: 1,
    matchedWords: ["запрос"],
    highlightRanges: [{ start: 0, end: 6 }]
  }));
  const excludedKeywordIds = matches
    .slice(0, 500)
    .map(({ keywordId }) => keywordId);
  const plan = negativeKeywordDeletionPlan(matches, excludedKeywordIds);

  assert.equal(plan.selectedCount, 200);
  assert.equal(plan.batch.length, 200);
  assert.equal(plan.batch[0]?.keywordId, matches[500]?.keywordId);
});

test("preview hash fences matches beyond the first deletion batch", async () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({
    id: keywordId(index),
    textOriginal: `купить слона номер ${index + 1}`,
    version: 1
  }));
  const service = new NegativeKeywordService({
    keyword: { findMany: async () => rows }
  } as never, {} as never);
  const command = {
    ...context,
    rules: {
      words: ["слон"],
      matchMode: "WORD_FORM_PRECISE" as const,
      caseSensitive: false,
      ignoreWordOrder: false,
      ignorePunctuation: false
    },
    scope: { kind: "PROJECT" as const },
    page: 1,
    pageSize: 100 as const
  };

  const before = await service.preview(command);
  rows[500] = { ...rows[500]!, version: 2 };
  const after = await service.preview(command);

  assert.notEqual(before.previewHash, after.previewHash);
});

function keywordId(index: number): string {
  return `01900000-0000-7000-8000-${String(index + 10).padStart(12, "0")}`;
}
