import assert from "node:assert/strict";
import test from "node:test";
import type { InternalDispatchCrawlAutomationRunInput } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import {
  CrawlAutomationDispatchClient,
  CrawlAutomationDispatchError
} from "./crawl-automation-dispatch.client.js";

const input = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  automationId: "01900000-0000-7000-8000-000000000004",
  automationVersion: 1,
  runId: "01900000-0000-7000-8000-000000000005",
  idempotencyKey: "crawl-automation-01900000-0000-7000-8000-000000000005",
  scheduledFor: "2026-08-27T12:00:00.000Z",
  config: {
    purpose: "TECHNICAL_AUDIT",
    startUrls: ["https://example.com/"],
    sitemapUrls: [],
    includePatterns: [],
    excludePatterns: [],
    queryPolicy: "DROP_TRACKING",
    maxUrls: 1,
    maxDepth: 0,
    maxRuntimeSeconds: 300,
    requestsPerMinute: 60,
    obeyRobots: true,
    savePageMap: true
  }
} as const satisfies InternalDispatchCrawlAutomationRunInput;

const config = {
  automationDispatchApiToken: "automation-secret",
  platformApiCommandTimeoutMs: 2_500,
  services: { platformApi: "http://backend-core:4000" }
} as AppConfig;

test("accepts the actor-scoped crawl returned by Platform API", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => response(input.actorId)) as typeof fetch;
  try {
    const result = await new CrawlAutomationDispatchClient(config).dispatch(
      input
    );
    assert.equal(result.crawl.actorId, input.actorId);
    assert.equal(result.crawl.status, "QUEUED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a crawl attributed to another actor", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    response("01900000-0000-7000-8000-000000000099")) as typeof fetch;
  try {
    await assert.rejects(
      new CrawlAutomationDispatchClient(config).dispatch(input),
      (error: unknown) =>
        error instanceof CrawlAutomationDispatchError &&
        error.code === "INVALID_RESPONSE" &&
        !error.retryable
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function response(actorId: string): Response {
  return Response.json(
    {
      data: {
        crawl: {
          id: "01900000-0000-7000-8000-000000000006",
          jobId: "01900000-0000-7000-8000-000000000007",
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId,
          status: "QUEUED",
          config: input.config,
          discoveredUrls: 0,
          processedUrls: 0,
          successfulUrls: 0,
          failedUrls: 0,
          issueCount: 0,
          version: 1,
          createdAt: "2026-08-27T12:00:00.000Z"
        }
      },
      meta: { requestId: `crawl-automation-${input.runId}` }
    },
    {
      status: 201,
      headers: { "cache-control": "private, no-store" }
    }
  );
}
