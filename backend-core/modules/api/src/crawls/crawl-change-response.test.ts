import assert from "node:assert/strict";
import test from "node:test";
import { crawlPageChangeCollection } from "./crawl-change-response.js";

const change = {
  id: "01900000-0000-7000-8000-000000000001",
  crawlId: "01900000-0000-7000-8000-000000000002",
  pageId: "01900000-0000-7000-8000-000000000003",
  url: "https://example.com/",
  severity: "WARNING",
  changedFields: ["title", "contentHash"],
  previousCrawledAt: "2026-07-30T10:00:00.000Z",
  currentCrawledAt: "2026-07-31T10:00:00.000Z",
  createdAt: "2026-07-31T10:00:00.000Z"
};

test("accepts an exact bounded crawl change collection", () => {
  assert.deepEqual(crawlPageChangeCollection({ changes: [change] }), {
    changes: [change]
  });
});

test("rejects extensible, duplicate and unknown change fields", () => {
  for (const candidate of [
    { ...change, diff: { rawHtml: "secret" } },
    { ...change, changedFields: ["title", "title"] },
    { ...change, changedFields: ["rawHtml"] }
  ]) {
    assert.throws(
      () => crawlPageChangeCollection({ changes: [candidate] }),
      /invalid crawl change response/u
    );
  }
});
