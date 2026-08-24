import assert from "node:assert/strict";
import test from "node:test";
import {
  MANUAL_KEYWORD_BULK_CHUNK_SIZE,
  manualKeywordDuplicateCanApply,
  manualKeywordDuplicatePolicy,
  manualKeywordInputStats,
  manualKeywordRetryRows,
  manualKeywordTexts,
  runManualKeywordBulkChunks,
  runManualKeywordBulkPreviewChunks
} from "./manual-keyword-input.ts";

test("normalizes pasted rows and detects duplicates like keyword storage", () => {
  const stats = manualKeywordInputStats(
    "  Нейросети   онлайн  \nнейросети онлайн\nНЕЙРОСЕТИ ОНЛАЙН\nёлка\nелка\n\n"
  );
  assert.equal(stats.total, 5);
  assert.equal(stats.unique, 2);
  assert.equal(stats.duplicates, 3);
  assert.deepEqual(stats.uniqueRows, ["Нейросети онлайн", "ёлка"]);
});

test("manual add always collapses repeated textarea rows before preview", () => {
  const value = "one\none\ntwo";
  assert.deepEqual(manualKeywordTexts(value), ["one", "two"]);
});

test("target-group import wins when both duplicate options are enabled", () => {
  assert.equal(
    manualKeywordDuplicatePolicy({
      addDuplicatesToGroup: true,
      inTargetGroup: false,
      previewState: "ACTIVE_DUPLICATE",
      selectedForTargetGroup: true,
      skipDuplicates: true
    }),
    "ADD_TO_GROUP"
  );
  assert.equal(
    manualKeywordDuplicatePolicy({
      addDuplicatesToGroup: true,
      inTargetGroup: false,
      previewState: "ACTIVE_DUPLICATE",
      selectedForTargetGroup: false,
      skipDuplicates: true
    }),
    "SKIP_EXISTING"
  );
  assert.equal(
    manualKeywordDuplicatePolicy({
      addDuplicatesToGroup: true,
      inTargetGroup: true,
      previewState: "ACTIVE_DUPLICATE",
      selectedForTargetGroup: true,
      skipDuplicates: true
    }),
    "ADD_TO_GROUP"
  );
});

test("trashed duplicates are restored only after an explicit row choice", () => {
  assert.equal(
    manualKeywordDuplicatePolicy({
      addDuplicatesToGroup: true,
      inTargetGroup: false,
      previewState: "TRASHED_DUPLICATE",
      selectedForTargetGroup: true,
      skipDuplicates: true
    }),
    "RESTORE_TRASHED"
  );
  assert.equal(
    manualKeywordDuplicatePolicy({
      addDuplicatesToGroup: true,
      inTargetGroup: false,
      previewState: "TRASHED_DUPLICATE",
      selectedForTargetGroup: false,
      skipDuplicates: false
    }),
    "SKIP_EXISTING"
  );
});

test("duplicate review offers only real moves and explicit trash restores", () => {
  const targetGroupId = "01900000-0000-7000-8000-000000000001";
  const targetGroup = {
    id: targetGroupId,
    name: "Новая",
    path: "Новая"
  };
  assert.equal(
    manualKeywordDuplicateCanApply({
      index: 0,
      state: "ACTIVE_DUPLICATE",
      groups: [targetGroup],
      groupsTruncated: false,
      inTargetGroup: true
    }, targetGroupId),
    false
  );
  assert.equal(
    manualKeywordDuplicateCanApply({
      index: 0,
      state: "ACTIVE_DUPLICATE",
      groups: [
        targetGroup,
        {
          id: "01900000-0000-7000-8000-000000000002",
          name: "Старая",
          path: "Старая"
        }
      ],
      groupsTruncated: false,
      inTargetGroup: true
    }, targetGroupId),
    true
  );
  assert.equal(
    manualKeywordDuplicateCanApply({
      index: 0,
      state: "TRASHED_DUPLICATE",
      groups: [],
      groupsTruncated: false,
      inTargetGroup: false
    }),
    true
  );
});

test("unresolved duplicates are rejected only when silent skipping is disabled", () => {
  assert.equal(
    manualKeywordDuplicatePolicy({
      addDuplicatesToGroup: false,
      inTargetGroup: false,
      previewState: "ACTIVE_DUPLICATE",
      selectedForTargetGroup: false,
      skipDuplicates: false
    }),
    "REJECT_EXISTING"
  );
  assert.equal(
    manualKeywordDuplicatePolicy({
      addDuplicatesToGroup: true,
      inTargetGroup: true,
      previewState: "ACTIVE_DUPLICATE",
      selectedForTargetGroup: false,
      skipDuplicates: false
    }),
    "SKIP_EXISTING"
  );
  assert.equal(
    manualKeywordDuplicatePolicy({
      addDuplicatesToGroup: false,
      inTargetGroup: false,
      previewState: "TRASHED_DUPLICATE",
      selectedForTargetGroup: false,
      skipDuplicates: false
    }),
    "SKIP_EXISTING"
  );
});

test("new preview rows keep a race-safe duplicate fallback", () => {
  assert.equal(
    manualKeywordDuplicatePolicy({
      addDuplicatesToGroup: true,
      inTargetGroup: false,
      previewState: "NEW",
      selectedForTargetGroup: false,
      skipDuplicates: true
    }),
    "ADD_TO_GROUP"
  );
  assert.equal(
    manualKeywordDuplicatePolicy({
      addDuplicatesToGroup: false,
      inTargetGroup: false,
      selectedForTargetGroup: false,
      skipDuplicates: false
    }),
    "REJECT_EXISTING"
  );
});

test("duplicate preview keeps global row indices across bounded chunks", async () => {
  const rows = Array.from({ length: 105 }, (_, index) => `query ${index}`);
  const preview = await runManualKeywordBulkPreviewChunks(
    rows,
    async (chunk, offset) => ({
      selected: chunk.length,
      newKeywords: chunk.length - (offset === 100 ? 1 : 0),
      activeDuplicates: offset === 100 ? 1 : 0,
      trashedDuplicates: 0,
      restorableDeleted: 0,
      rows: chunk.map((_, index) =>
        offset === 100 && index === 0
          ? {
              index,
              state: "ACTIVE_DUPLICATE" as const,
              keywordId: "01900000-0000-7000-8000-000000000090",
              version: 2,
              groups: [],
              groupsTruncated: false,
              inTargetGroup: false
            }
          : {
              index,
              state: "NEW" as const,
              groups: [],
              groupsTruncated: false,
              inTargetGroup: false
            }
      )
    })
  );

  assert.equal(preview.selected, 105);
  assert.equal(preview.activeDuplicates, 1);
  assert.equal(preview.rows[100]?.index, 100);
});

test("bulk retry preserves rejected and failed rows in server order", () => {
  assert.deepEqual(
    manualKeywordRetryRows(
      ["one", "one", "two", "three"],
      [
        { index: 0, outcome: "CREATED" },
        { index: 1, outcome: "REJECTED_EXISTING" },
        { index: 2, outcome: "RESTORED" },
        { index: 3, outcome: "FAILED" }
      ]
    ),
    ["one", "three"]
  );
});

test("bulk runner sends more than one chunk sequentially and aggregates outcomes", async () => {
  const rows = Array.from({ length: 205 }, (_, index) => `query ${index}`);
  const calls: Array<Readonly<{ offset: number; size: number }>> = [];
  let inFlight = 0;
  const result = await runManualKeywordBulkChunks(rows, async (chunk, offset) => {
    assert.equal(inFlight, 0);
    inFlight += 1;
    calls.push({ offset, size: chunk.length });
    await Promise.resolve();
    inFlight -= 1;
    const resultRows = chunk.map((_, index) => ({
      index,
      outcome: index === 0 && offset === 100
        ? "FAILED" as const
        : index === 99 && offset === 0
          ? "REJECTED_EXISTING" as const
          : "CREATED" as const
    }));
    const failed = resultRows.filter(({ outcome }) => outcome === "FAILED").length;
    const rejected = resultRows.filter(
      ({ outcome }) => outcome === "REJECTED_EXISTING"
    ).length;
    return {
      selected: chunk.length,
      created: chunk.length - failed - rejected,
      restored: 0,
      linked: 0,
      skipped: 0,
      rejected,
      failed,
      rows: resultRows
    };
  });

  assert.equal(MANUAL_KEYWORD_BULK_CHUNK_SIZE, 100);
  assert.deepEqual(calls, [
    { offset: 0, size: 100 },
    { offset: 100, size: 100 },
    { offset: 200, size: 5 }
  ]);
  assert.equal(result.created, 203);
  assert.equal(result.rejected, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.retryRows, ["query 99", "query 100"]);
  assert.deepEqual(result.trashCandidates, []);
});

test("network failure retains prior retry rows, current chunk and untouched tail", async () => {
  const rows = Array.from({ length: 205 }, (_, index) => `query ${index}`);
  const networkError = new Error("offline");
  const result = await runManualKeywordBulkChunks(rows, async (chunk, offset) => {
    if (offset === 100) throw networkError;
    return {
      selected: chunk.length,
      created: chunk.length - 1,
      restored: 0,
      linked: 0,
      skipped: 0,
      rejected: 1,
      failed: 0,
      rows: chunk.map((_, index) => ({
        index,
        outcome: index === 50 ? "REJECTED_EXISTING" as const : "CREATED" as const
      }))
    };
  });

  assert.equal(result.transportError, networkError);
  assert.equal(result.created, 99);
  assert.deepEqual(result.retryRows, ["query 50", ...rows.slice(100)]);
  assert.deepEqual(result.trashCandidates, []);
});

test("bulk runner returns trashed duplicates with their original text", async () => {
  const result = await runManualKeywordBulkChunks(
    ["active", "from trash"],
    async () => ({
      selected: 2,
      created: 0,
      restored: 0,
      linked: 0,
      skipped: 2,
      rejected: 0,
      failed: 0,
      rows: [
        {
          index: 0,
          outcome: "SKIPPED_EXISTING",
          keywordId: "01900000-0000-7000-8000-000000000090",
          version: 2
        },
        {
          index: 1,
          outcome: "SKIPPED_EXISTING",
          keywordId: "01900000-0000-7000-8000-000000000091",
          version: 3,
          trashed: true
        }
      ]
    })
  );

  assert.deepEqual(result.trashCandidates, [
    {
      index: 1,
      text: "from trash",
      keywordId: "01900000-0000-7000-8000-000000000091",
      version: 3
    }
  ]);
});

test("bulk runner preserves trash recovery when another duplicate is rejected", async () => {
  const result = await runManualKeywordBulkChunks(
    ["needs choice", "from trash"],
    async () => ({
      selected: 2,
      created: 0,
      restored: 0,
      linked: 0,
      skipped: 1,
      rejected: 1,
      failed: 0,
      rows: [
        { index: 0, outcome: "REJECTED_EXISTING" },
        {
          index: 1,
          outcome: "SKIPPED_EXISTING",
          keywordId: "01900000-0000-7000-8000-000000000091",
          version: 3,
          trashed: true
        }
      ]
    })
  );

  assert.deepEqual(result.retryRows, ["needs choice"]);
  assert.deepEqual(result.trashCandidates, [
    {
      index: 1,
      text: "from trash",
      keywordId: "01900000-0000-7000-8000-000000000091",
      version: 3
    }
  ]);
});

test("bulk runner counts canonical keywords linked to another folder", async () => {
  const result = await runManualKeywordBulkChunks(["seo аудит"], async () => ({
    selected: 1,
    created: 0,
    restored: 0,
    linked: 1,
    skipped: 0,
    rejected: 0,
    failed: 0,
    rows: [
      {
        index: 0,
        outcome: "LINKED_EXISTING",
        keywordId: "01900000-0000-7000-8000-000000000090",
        version: 2
      }
    ]
  }));

  assert.equal(result.linked, 1);
  assert.deepEqual(result.retryRows, []);
});
