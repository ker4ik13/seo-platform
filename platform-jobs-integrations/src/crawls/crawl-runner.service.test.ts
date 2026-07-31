import assert from "node:assert/strict";
import test from "node:test";
import type { TechnicalCrawlConfig } from "@seo-platform/contracts";
import { CrawlRunnerService } from "./crawl-runner.service.js";

const config: TechnicalCrawlConfig = {
  startUrls: ["https://example.com/"],
  sitemapUrls: [],
  includePatterns: [],
  excludePatterns: [],
  queryPolicy: "DROP_TRACKING",
  maxUrls: 100,
  maxDepth: 3,
  maxRuntimeSeconds: 60,
  requestsPerMinute: 30,
  obeyRobots: true
};

test("finishes an expired crawl as a bounded partial result", async () => {
  const finalized: unknown[] = [];
  const finished: unknown[][] = [];
  const crawls = {
    claim: async () => ({
      id: "01900000-0000-7000-8000-000000000001",
      workspaceId: "01900000-0000-7000-8000-000000000002",
      projectId: "01900000-0000-7000-8000-000000000003",
      status: "RUNNING",
      startedAt: new Date(Date.now() - 61_000),
      processedUrls: 2
    }),
    config: () => config,
    checkpoint: () => ({
      version: 2,
      pending: [],
      seen: [...config.startUrls],
      sitemapPending: [],
      sitemapSeen: [],
      scopeReady: true
    }),
    get: async () => ({ processedUrls: 2 }),
    finish: async (...args: unknown[]) => {
      finished.push(args);
    }
  };
  const snapshots = {
    finalize: async (input: unknown) => {
      finalized.push(input);
    }
  };
  const runner = new CrawlRunnerService(
    {
      crawl: {
        leaseSeconds: 120,
        requestTimeoutMs: 10_000,
        maxResponseBytes: 1_000_000,
        maxRedirects: 5,
        userAgent: "SeoPlatformCrawler/1.0"
      }
    } as never,
    crawls as never,
    snapshots as never,
    {
      currentBackoff: async () => {
        throw new Error("Host state must not be read after the deadline");
      }
    } as never
  );

  await runner.process(
    "01900000-0000-7000-8000-000000000001",
    "crawl-test-worker"
  );

  assert.deepEqual(finalized, [{
    workspaceId: "01900000-0000-7000-8000-000000000002",
    projectId: "01900000-0000-7000-8000-000000000003",
    crawlId: "01900000-0000-7000-8000-000000000001",
    status: "PARTIALLY_COMPLETED",
    processedUrls: 2
  }]);
  assert.deepEqual(finished, [[
    "01900000-0000-7000-8000-000000000001",
    "crawl-test-worker",
    "PARTIALLY_COMPLETED",
    "MAX_RUNTIME_EXCEEDED"
  ]]);
});
