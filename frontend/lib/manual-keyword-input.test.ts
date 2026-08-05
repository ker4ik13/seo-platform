import assert from "node:assert/strict";
import test from "node:test";
import {
  MANUAL_KEYWORD_BULK_CHUNK_SIZE,
  manualKeywordInputStats,
  manualKeywordRetryRows,
  manualKeywordTexts,
  runManualKeywordBulkChunks
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

test("skip policy deduplicates textarea while reject policy preserves every row", () => {
  const value = "one\none\ntwo";
  assert.deepEqual(manualKeywordTexts(value, true), ["one", "two"]);
  assert.deepEqual(manualKeywordTexts(value, false), ["one", "one", "two"]);
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
