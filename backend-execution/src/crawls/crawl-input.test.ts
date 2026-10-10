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
  assert.equal(config.savePageMap, true);
});

test("accepts a 5000-page crawl and an explicit map opt-out", () => {
  const config = crawlConfig({
    ...base,
    maxUrls: 5_000,
    savePageMap: false
  });
  assert.equal(config.maxUrls, 5_000);
  assert.equal(config.savePageMap, false);
  assert.throws(() => crawlConfig({ ...base, maxUrls: 5_001 }));
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

test("owning crawl parser accepts four pages per second and rejects faster settings", () => {
  assert.equal(crawlConfig({ ...base, requestsPerMinute: 240 }).requestsPerMinute, 240);
  assert.throws(() => crawlConfig({ ...base, requestsPerMinute: 241 }));
});
