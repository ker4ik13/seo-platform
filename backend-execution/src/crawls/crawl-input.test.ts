import assert from "node:assert/strict";
import test from "node:test";
import { crawlConfig } from "./crawl-input.js";

const base = {
  purpose: "HTTP_STATUS_CHECK",
  startUrls: ["https://example.com/"],
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

test("accepts bounded homepage checks for an HTTP status crawl", () => {
  const config = crawlConfig({
    ...base,
    homepageChecks: ["HTTP_TO_HTTPS", "WWW_CANONICAL", "MULTIPLE_SLASHES"]
  });
  assert.deepEqual(config.homepageChecks, [
    "HTTP_TO_HTTPS",
    "WWW_CANONICAL",
    "MULTIPLE_SLASHES"
  ]);
});

test("rejects homepage checks for audits and configurations that exceed maxUrls", () => {
  assert.throws(() =>
    crawlConfig({
      ...base,
      purpose: "TECHNICAL_AUDIT",
      homepageChecks: ["WWW_CANONICAL"]
    })
  );
  assert.throws(() =>
    crawlConfig({
      ...base,
      homepageChecks: ["MULTIPLE_SLASHES"],
      maxUrls: 4
    })
  );
});
