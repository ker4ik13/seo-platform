import assert from "node:assert/strict";
import test from "node:test";
import type { TechnicalCrawlConfig } from "@seo-platform/contracts";
import { crawlMembershipScopeHash } from "./crawl-membership-scope.js";
import { CrawlRunnerService } from "./crawl-runner.service.js";

const config: TechnicalCrawlConfig = {
  purpose: "TECHNICAL_AUDIT",
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
      pending: [{ url: "https://example.com/pending", depth: 1, inSitemap: false }],
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
      return { accepted: true, issueCount: 4 };
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
    purpose: "TECHNICAL_AUDIT",
    status: "PARTIALLY_COMPLETED",
    processedUrls: 2,
    scopeHash: crawlMembershipScopeHash(config)
  }]);
  assert.deepEqual(finished, [[
    "01900000-0000-7000-8000-000000000001",
    "crawl-test-worker",
    "PARTIALLY_COMPLETED",
    "MAX_RUNTIME_EXCEEDED",
    4
  ]]);
});

test("retries finalization from a complete checkpoint without fetching after the runtime deadline", async () => {
  const finished: unknown[][] = [], failed: unknown[][] = [];
  const crawl = { id: "01900000-0000-7000-8000-000000000011", workspaceId: "01900000-0000-7000-8000-000000000012", projectId: "01900000-0000-7000-8000-000000000013", status: "RUNNING", processedUrls: 2568, failedUrls: 0, startedAt: new Date(0) };
  let rejectFinalization = false;
  const runner = new CrawlRunnerService({ crawl: { leaseSeconds: 120 } } as never, {
    claim: async () => crawl, config: () => config,
    checkpoint: () => ({ version: 2, pending: [], seen: [], sitemapPending: [], sitemapSeen: [], scopeReady: true }),
    get: async () => crawl, finish: async (...args: unknown[]) => { finished.push(args); }, fail: async (...args: unknown[]) => { failed.push(args); }
  } as never, { finalize: async () => { if (rejectFinalization) throw new Error("private database error"); return { accepted: true, issueCount: 12000 }; } } as never,
  { currentBackoff: async () => { throw new Error("No HTTP/host access during finalization"); } } as never);
  await runner.process(crawl.id, "worker", true);
  assert.deepEqual(finished, [[crawl.id, "worker", "COMPLETED", undefined, 12000]]);
  rejectFinalization = true;
  await runner.process(crawl.id, "worker", true);
  assert.deepEqual(failed, [[crawl.id, "CRAWL_FINALIZATION_FAILED", "worker"]]);
});
