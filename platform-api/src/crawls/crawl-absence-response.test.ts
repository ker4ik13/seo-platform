import assert from "node:assert/strict";
import test from "node:test";
import { crawlAbsentPageCollection } from "./crawl-absence-response.js";

const crawlId = "01900000-0000-7000-8000-000000000001";
const page = {
  pageId: "01900000-0000-7000-8000-000000000002",
  url: "https://example.com/removed",
  previousCrawlId: "01900000-0000-7000-8000-000000000003",
  previousSnapshotId: "01900000-0000-7000-8000-000000000004",
  wasInSitemap: true,
  lastSeenAt: "2026-08-01T10:00:00.000Z",
  detectedAt: "2026-08-02T10:00:00.000Z"
};

test("accepts an exact bounded absent-page collection", () => {
  assert.deepEqual(
    crawlAbsentPageCollection({ crawlId, pages: [page] }, crawlId),
    { crawlId, pages: [page] }
  );
});

test("rejects cross-crawl, unsafe and contradictory absence evidence", () => {
  for (const candidate of [
    { crawlId: page.previousCrawlId, pages: [page] },
    { crawlId, pages: [{ ...page, rawHtml: "<secret>" }] },
    { crawlId, pages: [{ ...page, url: "javascript:alert(1)" }] },
    { crawlId, pages: [{ ...page, previousCrawlId: crawlId }] },
    {
      crawlId,
      pages: [{
        ...page,
        detectedAt: "2026-07-31T10:00:00.000Z"
      }]
    },
    { crawlId, pages: [page, page] }
  ]) {
    assert.throws(
      () => crawlAbsentPageCollection(candidate, crawlId),
      /invalid crawl absence response/u
    );
  }
});
