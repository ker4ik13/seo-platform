import assert from "node:assert/strict";
import test from "node:test";
import {
  detectCrawlDuplicateGroups,
  duplicateIssue,
  type CrawlDuplicateSnapshot
} from "./crawl-duplicates.js";

test("groups successful HTML snapshots by normalized SEO fields", () => {
  const groups = detectCrawlDuplicateGroups([
    snapshot(1, {
      title: " Каталог   обуви ",
      description: "Описание",
      h1: "Обувь",
      contentHash: "a".repeat(64)
    }),
    snapshot(2, {
      title: "каталог обуви",
      description: "описание",
      h1: "ОБУВЬ",
      contentHash: "a".repeat(64)
    }),
    snapshot(3, {
      title: "Другая страница",
      description: null,
      h1: null,
      contentHash: "b".repeat(64)
    })
  ]);

  assert.deepEqual(
    groups.map(({ kind, members }) => ({
      kind,
      sequences: members.map(({ sequence }) => sequence)
    })),
    [
      { kind: "CONTENT", sequences: [1, 2] },
      { kind: "TITLE", sequences: [1, 2] },
      { kind: "DESCRIPTION", sequences: [1, 2] },
      { kind: "H1", sequences: [1, 2] }
    ]
  );
  assert.ok(groups.every(({ signatureHash }) =>
    /^[0-9a-f]{64}$/u.test(signatureHash)
  ));
});

test("ignores error, non-HTML and empty-content snapshots", () => {
  const groups = detectCrawlDuplicateGroups([
    snapshot(1, { statusCode: 404 }),
    snapshot(2, { contentType: "application/json" }),
    snapshot(3, { title: null, wordCount: 0 }),
    snapshot(4, { title: null, wordCount: 0 })
  ]);
  assert.deepEqual(groups, []);
});

test("maps duplicate kinds to stable issue evidence", () => {
  assert.deepEqual(duplicateIssue("CONTENT"), {
    code: "DUPLICATE_CONTENT_GROUP",
    severity: "ERROR",
    title: "Дублирующийся контент"
  });
  assert.equal(duplicateIssue("TITLE").severity, "WARNING");
});

function snapshot(
  sequence: number,
  override: Partial<CrawlDuplicateSnapshot> = {}
): CrawlDuplicateSnapshot {
  return { ...baseSnapshot(sequence), ...override };
}

function baseSnapshot(sequence: number): CrawlDuplicateSnapshot {
  return {
    id: `01900000-0000-7000-8000-${String(sequence).padStart(12, "0")}`,
    pageId: `01900000-0000-7001-8000-${String(sequence).padStart(12, "0")}`,
    sequence,
    finalUrl: `https://example.com/${sequence}`,
    statusCode: 200,
    contentType: "text/html; charset=utf-8",
    title: "Title",
    description: null,
    h1: null,
    wordCount: 100,
    contentHash: `${sequence}`.repeat(64).slice(0, 64),
    crawledAt: new Date(`2026-08-01T10:00:0${sequence}.000Z`)
  };
}
