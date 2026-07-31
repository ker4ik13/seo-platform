import assert from "node:assert/strict";
import test from "node:test";
import {
  crawlCheckpointJson,
  initialCrawlCheckpoint,
  storedCrawlCheckpoint
} from "./crawl-checkpoint.js";

const config = {
  startUrls: ["https://example.com/"],
  sitemapUrls: [],
  includePatterns: [],
  excludePatterns: [],
  queryPolicy: "DROP_TRACKING" as const,
  maxUrls: 100,
  maxDepth: 3,
  requestsPerMinute: 30,
  obeyRobots: true as const
};

test("round-trips a bounded same-origin crawl checkpoint", () => {
  const initial = initialCrawlCheckpoint(config);
  assert.deepEqual(
    storedCrawlCheckpoint(crawlCheckpointJson(initial), config),
    initial
  );
});

test("retains an explicit discovery seed outside the include scope", () => {
  const scopedConfig = {
    ...config,
    sitemapUrls: ["https://example.com/sitemap.xml"],
    includePatterns: ["/catalog/**"]
  };
  const initial = initialCrawlCheckpoint(scopedConfig);
  assert.deepEqual(initial, {
    version: 2,
    pending: [
      {
        url: "https://example.com/",
        depth: 0,
        inSitemap: false
      }
    ],
    seen: ["https://example.com/"],
    sitemapPending: ["https://example.com/sitemap.xml"],
    sitemapSeen: ["https://example.com/sitemap.xml"],
    scopeReady: false
  });
  assert.deepEqual(
    storedCrawlCheckpoint(crawlCheckpointJson(initial), scopedConfig),
    initial
  );
});

test("rejects foreign, duplicate and out-of-depth checkpoint URLs", () => {
  for (const checkpoint of [
    {
      version: 1,
      pending: [{ url: "https://foreign.example/", depth: 1 }],
      seen: ["https://foreign.example/"]
    },
    {
      version: 1,
      pending: [],
      seen: ["https://example.com/", "https://example.com/"]
    },
    {
      version: 1,
      pending: [{ url: "https://example.com/deep", depth: 4 }],
      seen: ["https://example.com/deep"]
    }
  ]) {
    assert.throws(
      () => storedCrawlCheckpoint(checkpoint, config),
      /Stored crawl checkpoint is invalid/u
    );
  }
});
