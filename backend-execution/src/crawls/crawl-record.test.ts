import assert from "node:assert/strict";
import test from "node:test";
import { storedCrawlConfig } from "./crawl-record.js";

const stored = {
  purpose: "HTTP_STATUS_CHECK",
  startUrls: ["https://example.com/"],
  homepageChecks: ["HTTP_TO_HTTPS", "WWW_CANONICAL", "MULTIPLE_SLASHES"],
  sitemapUrls: [],
  includePatterns: [],
  excludePatterns: [],
  queryPolicy: "DROP_TRACKING",
  maxUrls: 100,
  maxDepth: 0,
  maxRuntimeSeconds: 3_600,
  requestsPerMinute: 30,
  obeyRobots: true
};

test("restores homepage checks after a worker restart", () => {
  assert.deepEqual(storedCrawlConfig(stored as never).homepageChecks, [
    "HTTP_TO_HTTPS",
    "WWW_CANONICAL",
    "MULTIPLE_SLASHES"
  ]);
});

test("rejects persisted homepage checks outside an HTTP status operation", () => {
  assert.throws(
    () => storedCrawlConfig({ ...stored, purpose: "TECHNICAL_AUDIT" } as never),
    /Stored crawl config is invalid/u
  );
});
