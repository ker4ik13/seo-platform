import assert from "node:assert/strict";
import test from "node:test";
import type { TechnicalCrawlConfig } from "@seo-platform/contracts";
import { crawlMembershipScopeHash } from "./crawl-membership-scope.js";

const config: TechnicalCrawlConfig = {
  startUrls: ["https://example.com/"],
  sitemapUrls: ["https://example.com/sitemap.xml"],
  includePatterns: ["/catalog/**"],
  excludePatterns: ["/catalog/private/**"],
  queryPolicy: "DROP_TRACKING",
  maxUrls: 500,
  maxDepth: 3,
  maxRuntimeSeconds: 3_600,
  requestsPerMinute: 30,
  obeyRobots: true
};

test("binds membership only to settings that determine crawl scope", () => {
  const expected = crawlMembershipScopeHash(config);

  assert.match(expected, /^[0-9a-f]{64}$/u);
  assert.equal(
    crawlMembershipScopeHash({
      ...config,
      maxRuntimeSeconds: 7_200,
      requestsPerMinute: 10
    }),
    expected
  );
  assert.notEqual(
    crawlMembershipScopeHash({ ...config, maxDepth: 4 }),
    expected
  );
  assert.notEqual(
    crawlMembershipScopeHash({
      ...config,
      startUrls: ["https://example.com/catalog/"]
    }),
    expected
  );
});
