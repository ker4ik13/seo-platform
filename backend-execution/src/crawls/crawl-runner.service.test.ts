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

function pipelineFixture(options: { rate: number; cancel?: boolean; backoff?: boolean; failPersistence?: boolean }) {
  const urls = Array.from({ length: 12 }, (_, index) => `https://example.com/page-${index}`);
  const crawl = { id: "01900000-0000-7000-8000-000000000021", workspaceId: "01900000-0000-7000-8000-000000000022", projectId: "01900000-0000-7000-8000-000000000023", status: "RUNNING", processedUrls: 0, failedUrls: 0, startedAt: new Date() };
  const checkpoints: { pending: { url: string }[] }[] = [], persisted: { sequence: number; requestedUrl: string }[] = [], starts: number[] = [], finished: unknown[][] = [], released: unknown[][] = [];
  let active = 0, peak = 0, cancellation = false;
  const runner = new CrawlRunnerService({ crawl: { leaseSeconds: 120, requestTimeoutMs: 10_000, maxResponseBytes: 2_000_000, maxRedirects: 5, userAgent: "SeoPlatformCrawler/1.0" } } as never, {
    claim: async () => crawl,
    config: () => ({ ...config, requestsPerMinute: options.rate, conditionalRequests: false }),
    checkpoint: () => ({ version: 2, pending: urls.map(url => ({ url, depth: 0, inSitemap: true })), seen: urls, sitemapPending: [], sitemapSeen: [], scopeReady: true }),
    saveCheckpoint: async (_id: string, _owner: string, _seconds: number, value: { pending: { url: string }[] }) => { checkpoints.push(value); },
    recordPage: async (_id: string, _owner: string, _seconds: number, _result: unknown, value: { pending: { url: string }[] }) => { crawl.processedUrls++; checkpoints.push(value); if (options.cancel) cancellation = true; },
    isCancellationRequested: async () => cancellation,
    get: async () => crawl,
    finish: async (...args: unknown[]) => { assert.equal(active, 0); finished.push(args); },
    releaseForHostBackoff: async (...args: unknown[]) => { assert.equal(active, 0); released.push(args); },
    releaseForRetry: async () => { assert.equal(active, 0); },
  } as never, {
    persistPage: async (value: { sequence: number; requestedUrl: string }) => {
      if (options.failPersistence) throw new Error("Persistence temporarily unavailable");
      persisted.push(value); return { accepted: true, success: true, issueCount: 0 };
    },
    finalize: async () => ({ accepted: true, issueCount: 0 })
  } as never, {
    currentBackoff: async () => undefined,
    recordResponse: async () => undefined,
    recordFailure: async () => new Date(Date.now() + 5000)
  } as never);
  Object.defineProperty(runner, "resource", { value: async (url: string, request: { beforeRequest?: () => Promise<void> }) => {
    await request.beforeRequest?.();
    const robots = url.endsWith("/robots.txt");
    if (!robots) {
      starts.push(Date.now()); active++; peak = Math.max(peak, active);
      // The first response finishes after the second; commit must stay ordered.
      await new Promise(resolve => setTimeout(resolve, options.backoff ? 10 : url.endsWith("-1") ? 100 : 1000));
      active--;
    }
    const body = Buffer.from(robots ? "User-agent: *\nAllow: /\n" : "<html><head><title>Page</title></head><body><h1>Page</h1></body></html>");
    return { requestedUrl: url, finalUrl: url, redirectChain: [], statusCode: !robots && options.backoff ? 429 : 200, contentType: robots ? "text/plain" : "text/html", body, sizeBytes: body.length, responseTimeMs: robots ? 0 : 1000 };
  } });
  return { runner, crawl, starts, checkpoints, persisted, finished, released, urls, peak: () => peak };
}

for (const rate of [180, 240]) {
  test(`overlaps slow page fetches at ${rate / 60} pages/sec and commits ordered checkpoints`, async () => {
    const fixture = pipelineFixture({ rate }), started = Date.now();
    await fixture.runner.process(fixture.crawl.id, "worker");
    assert.ok(Date.now() - started < 6500, "sequential network latency must not limit the configured rate");
    assert.ok(fixture.peak() >= 3);
    for (let i = 1; i < fixture.starts.length; i++) assert.ok(fixture.starts[i]! - fixture.starts[i - 1]! >= Math.ceil(60000 / rate) - 15);
    assert.deepEqual(fixture.persisted.map(page => page.requestedUrl), fixture.urls);
    assert.deepEqual(fixture.persisted.map(page => page.sequence), Array.from({ length: 12 }, (_, index) => index + 1));
    assert.equal(fixture.checkpoints.at(-1)?.pending.length, 0);
    assert.equal(fixture.finished[0]?.[2], "COMPLETED");
  });
}

test("cancellation drains HTTP before terminal state and retains uncommitted URLs", async () => {
  const fixture = pipelineFixture({ rate: 240, cancel: true });
  await fixture.runner.process(fixture.crawl.id, "worker");
  assert.equal(fixture.persisted.length, 1);
  assert.equal(fixture.finished[0]?.[2], "CANCELLED");
  assert.deepEqual(fixture.checkpoints.at(-1)?.pending.map(page => page.url), fixture.urls.slice(1));
});

test("prefetched 429 stops further HTTP and keeps the whole uncommitted checkpoint", async () => {
  const fixture = pipelineFixture({ rate: 240, backoff: true });
  await fixture.runner.process(fixture.crawl.id, "worker");
  assert.equal(fixture.starts.length, 1);
  assert.equal(fixture.persisted.length, 0);
  assert.deepEqual(fixture.checkpoints.at(-1)?.pending.map(page => page.url), fixture.urls);
  assert.equal(fixture.released[0]?.[3], "HOST_RATE_LIMIT");
});

test("persistence failure releases for retry only after prefetch drains", async () => {
  const fixture = pipelineFixture({ rate: 240, failPersistence: true });
  await assert.rejects(fixture.runner.process(fixture.crawl.id, "worker"), /retry scheduled/);
  assert.deepEqual(fixture.checkpoints.at(-1)?.pending.map(page => page.url), fixture.urls);
  assert.equal(fixture.finished.length, 0);
});
