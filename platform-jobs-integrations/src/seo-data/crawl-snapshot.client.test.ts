import assert from "node:assert/strict";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import { CrawlSnapshotClient } from "./crawl-snapshot.client.js";

const pageInput = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  crawlId: "01900000-0000-7000-8000-000000000003",
  sequence: 1,
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  depth: 0,
  statusCode: 200,
  responseTimeMs: 120,
  sizeBytes: 1024,
  contentType: "text/html",
  h1Count: 1,
  headings: [],
  hreflang: [],
  internalLinks: [],
  externalLinks: [],
  imageCount: 0,
  imagesMissingAlt: 0,
  structuredDataTypes: [],
  wordCount: 100,
  contentHash: "a".repeat(64),
  indexability: "INDEXABLE" as const,
  issues: [],
  crawledAt: "2026-07-31T06:00:00.000Z"
};

test("accepts only the exact idempotent crawl persistence receipt", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    response({
      data: { accepted: true, issueCount: 2, success: true },
      meta: { requestId: "crawl-receipt-001" }
    })) as typeof fetch;

  try {
    assert.deepEqual(await client().persistPage(pageInput), {
      accepted: true,
      issueCount: 2,
      success: true
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects extensible and oversized crawl persistence responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const candidate of [
      {
        data: {
          accepted: true,
          issueCount: 0,
          success: true,
          rawHtml: "<secret>"
        },
        meta: { requestId: "crawl-receipt-002" }
      },
      {
        data: { accepted: true, issueCount: 101, success: true },
        meta: { requestId: "crawl-receipt-003" }
      }
    ]) {
      globalThis.fetch = (async (): Promise<Response> =>
        response(candidate)) as typeof fetch;
      await assert.rejects(
        client().persistPage(pageInput),
        /SEO Data crawl response is invalid/u
      );
    }

    globalThis.fetch = (async (): Promise<Response> =>
      new Response("x".repeat(8_193), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "8193"
        }
      })) as typeof fetch;
    await assert.rejects(
      client().persistPage(pageInput),
      /SEO Data crawl response is invalid/u
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function client(): CrawlSnapshotClient {
  return new CrawlSnapshotClient(
    loadAppConfig(
      {
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        JOBS_TO_SEO_DATA_TOKEN: "s".repeat(32),
        SEO_DATA_URL: "http://seo-data.test:4001"
      },
      "CRAWL_WORKER"
    )
  );
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
