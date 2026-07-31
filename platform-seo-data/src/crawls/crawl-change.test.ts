import assert from "node:assert/strict";
import test from "node:test";
import type { InternalPersistCrawlPageInput } from "@seo-platform/contracts";
import {
  detectCrawlPageChange,
  type CrawlChangeSnapshot
} from "./crawl-change.js";

const current: InternalPersistCrawlPageInput = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  crawlId: "01900000-0000-7000-8000-000000000003",
  sequence: 1,
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  redirectChain: [],
  depth: 0,
  statusCode: 200,
  responseTimeMs: 800,
  sizeBytes: 10_000,
  contentType: "text/html",
  title: "Title",
  description: "Description",
  h1: "Heading",
  h1Count: 1,
  canonicalUrl: "https://example.com/",
  robots: "index,follow",
  language: "en",
  headings: [{ level: 1, text: "Heading" }],
  hreflang: [{ language: "en", url: "https://example.com/" }],
  internalLinks: ["https://example.com/a", "https://example.com/b"],
  externalLinks: [],
  imageCount: 1,
  imagesMissingAlt: 0,
  structuredDataTypes: ["Article"],
  wordCount: 100,
  contentHash: "a".repeat(64),
  indexability: "INDEXABLE",
  issues: [],
  crawledAt: "2026-07-31T10:00:00.000Z"
};

const previous: CrawlChangeSnapshot = {
  id: "01900000-0000-7000-8000-000000000004",
  statusCode: current.statusCode,
  redirectChain: current.redirectChain,
  responseTimeMs: current.responseTimeMs,
  sizeBytes: current.sizeBytes,
  title: current.title ?? null,
  description: current.description ?? null,
  h1: current.h1 ?? null,
  h1Count: current.h1Count,
  canonicalUrl: current.canonicalUrl ?? null,
  robots: current.robots ?? null,
  language: current.language ?? null,
  headings: current.headings,
  hreflang: current.hreflang,
  internalLinks: [...current.internalLinks].reverse(),
  externalLinks: current.externalLinks,
  imageCount: current.imageCount,
  imagesMissingAlt: current.imagesMissingAlt,
  structuredDataTypes: current.structuredDataTypes,
  wordCount: current.wordCount,
  contentHash: current.contentHash,
  indexability: current.indexability,
  crawledAt: new Date("2026-07-30T10:00:00.000Z")
};

test("does not report ordering noise or changes below configured thresholds", () => {
  assert.equal(
    detectCrawlPageChange(
      { ...previous, responseTimeMs: 550, sizeBytes: 9_500, wordCount: 95 },
      current
    ),
    undefined
  );
});

test("creates deterministic normalized diff and raises critical 5xx", () => {
  const change = detectCrawlPageChange(previous, {
    ...current,
    statusCode: 503,
    title: "Unavailable",
    internalLinks: ["https://example.com/a"],
    contentHash: "b".repeat(64)
  });
  assert.ok(change);
  assert.equal(change.severity, "CRITICAL");
  assert.deepEqual(change.changedFields, [
    "statusCode",
    "title",
    "internalLinks",
    "contentHash"
  ]);
  assert.match(change.beforeHash, /^[0-9a-f]{64}$/u);
  assert.match(change.afterHash, /^[0-9a-f]{64}$/u);
  assert.match(change.diffHash, /^[0-9a-f]{64}$/u);
  assert.notEqual(change.beforeHash, change.afterHash);
  assert.deepEqual(change.diff.fields[2], {
    field: "internalLinks",
    beforeHash: change.diff.fields[2]?.beforeHash,
    afterHash: change.diff.fields[2]?.afterHash,
    beforeCount: 2,
    afterCount: 1
  });
});
