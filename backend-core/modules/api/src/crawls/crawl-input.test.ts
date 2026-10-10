import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTechnicalCrawlProjectDomain,
  createTechnicalCrawlInput
} from "./crawl-input.js";

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
      purpose: "TECHNICAL_AUDIT",
      startUrls: ["https://example.com/"],
      sitemapUrls: [],
      includePatterns: [],
      excludePatterns: [],
      queryPolicy: "DROP_TRACKING",
      maxUrls: 100,
      maxDepth: 3,
      maxRuntimeSeconds: 3_600,
      requestsPerMinute: 30,
      obeyRobots: true,
      savePageMap: true,
      conditionalRequests: true,
      respectNofollow: false,
      requestTimeoutMs: 20_000,
      maxResponseBytes: 2_000_000,
      maxRedirects: 5
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

test("binds every crawl seed to the current project domain", () => {
  const input = createTechnicalCrawlInput({
    ...baseConfig(),
    purpose: "HTTP_STATUS_CHECK",
    sitemapUrls: ["https://example.com/sitemap.xml"]
  });
  assert.doesNotThrow(() =>
    assertTechnicalCrawlProjectDomain(input, "EXAMPLE.COM.")
  );
  assert.throws(() =>
    assertTechnicalCrawlProjectDomain(input, "another.example")
  );
});

test("accepts bounded homepage redirect checks only for HTTP status operations", () => {
  const input = createTechnicalCrawlInput({
    ...baseConfig(),
    purpose: "HTTP_STATUS_CHECK",
    homepageChecks: [
      "HTTP_TO_HTTPS",
      "WWW_CANONICAL",
      "MULTIPLE_SLASHES"
    ]
  });
  assert.deepEqual(input.homepageChecks, [
    "HTTP_TO_HTTPS",
    "WWW_CANONICAL",
    "MULTIPLE_SLASHES"
  ]);
  assert.throws(() =>
    createTechnicalCrawlInput({
      ...baseConfig(),
      homepageChecks: ["WWW_CANONICAL"]
    })
  );
  assert.throws(() =>
    createTechnicalCrawlInput({
      ...baseConfig(),
      purpose: "HTTP_STATUS_CHECK",
      homepageChecks: ["MULTIPLE_SLASHES"],
      maxUrls: 4
    })
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
      purpose: "TECHNICAL_AUDIT",
      startUrls: ["https://example.com/"],
      sitemapUrls: ["https://example.com/sitemap.xml"],
      includePatterns: ["/catalog/**"],
      excludePatterns: ["/catalog/private/*"],
      queryPolicy: "DROP_ALL",
      maxUrls: 500,
      maxDepth: 2,
      maxRuntimeSeconds: 3_600,
      requestsPerMinute: 20,
      obeyRobots: true,
      savePageMap: true,
      conditionalRequests: true,
      respectNofollow: false,
      requestTimeoutMs: 20_000,
      maxResponseBytes: 2_000_000,
      maxRedirects: 5
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

test("accepts the four-page-per-second UI setting without weakening the upper bound", () => {
  assert.equal(createTechnicalCrawlInput({ ...baseConfig(), requestsPerMinute: 240 }).requestsPerMinute, 240);
  assert.throws(() => createTechnicalCrawlInput({ ...baseConfig(), requestsPerMinute: 241 }));
});
