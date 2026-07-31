import assert from "node:assert/strict";
import test from "node:test";
import { createTechnicalCrawlInput } from "./crawl-input.js";

test("accepts one same-origin bounded crawl command", () => {
  assert.deepEqual(
    createTechnicalCrawlInput({
      startUrls: ["HTTPS://Example.COM/"],
      maxUrls: 100,
      maxDepth: 3,
      requestsPerMinute: 30,
      obeyRobots: true
    }),
    {
      startUrls: ["https://example.com/"],
      sitemapUrls: [],
      includePatterns: [],
      excludePatterns: [],
      queryPolicy: "DROP_TRACKING",
      maxUrls: 100,
      maxDepth: 3,
      maxRuntimeSeconds: 3_600,
      requestsPerMinute: 30,
      obeyRobots: true
    }
  );
});

test("rejects cross-origin, credential and robots bypass commands", () => {
  const base = {
    startUrls: ["https://example.com/"],
    maxUrls: 100,
    maxDepth: 3,
    requestsPerMinute: 30,
    obeyRobots: true
  };
  assert.throws(() =>
    createTechnicalCrawlInput({
      ...base,
      startUrls: ["https://example.com/", "https://other.example/"]
    })
  );
  assert.throws(() =>
    createTechnicalCrawlInput({
      ...base,
      startUrls: ["https://user:secret@example.com/"]
    })
  );
  assert.throws(() =>
    createTechnicalCrawlInput({ ...base, obeyRobots: false })
  );
  assert.throws(() =>
    createTechnicalCrawlInput({ ...base, maxRuntimeSeconds: 59 })
  );
  assert.throws(() =>
    createTechnicalCrawlInput({ ...base, maxRuntimeSeconds: 21_601 })
  );
});

test("normalizes bounded sitemap scope and rejects unsafe patterns", () => {
  assert.deepEqual(
    createTechnicalCrawlInput({
      startUrls: ["https://example.com/"],
      sitemapUrls: ["HTTPS://EXAMPLE.COM/sitemap.xml"],
      includePatterns: ["/catalog/**"],
      excludePatterns: ["/catalog/private/*"],
      queryPolicy: "DROP_ALL",
      maxUrls: 500,
      maxDepth: 2,
      requestsPerMinute: 20,
      obeyRobots: true
    }),
    {
      startUrls: ["https://example.com/"],
      sitemapUrls: ["https://example.com/sitemap.xml"],
      includePatterns: ["/catalog/**"],
      excludePatterns: ["/catalog/private/*"],
      queryPolicy: "DROP_ALL",
      maxUrls: 500,
      maxDepth: 2,
      maxRuntimeSeconds: 3_600,
      requestsPerMinute: 20,
      obeyRobots: true
    }
  );
  assert.throws(() =>
    createTechnicalCrawlInput({
      ...baseConfig(),
      includePatterns: ["catalog/**"]
    })
  );
  assert.throws(() =>
    createTechnicalCrawlInput({
      ...baseConfig(),
      sitemapUrls: ["https://other.example/sitemap.xml"]
    })
  );
});

function baseConfig() {
  return {
    startUrls: ["https://example.com/"],
    maxUrls: 100,
    maxDepth: 3,
    requestsPerMinute: 30,
    obeyRobots: true
  };
}
