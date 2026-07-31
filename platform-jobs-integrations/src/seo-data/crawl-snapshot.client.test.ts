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
  redirectChain: [],
  inSitemap: false,
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

test("accepts a bounded duplicate finalization issue count", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    response({
      data: { accepted: true, issueCount: 4 },
      meta: { requestId: "crawl-finalize-001" }
    })) as typeof fetch;
  try {
    assert.deepEqual(
      await client().finalize({
        workspaceId: pageInput.workspaceId,
        projectId: pageInput.projectId,
        crawlId: pageInput.crawlId,
        status: "COMPLETED",
        processedUrls: 2
      }),
      { accepted: true, issueCount: 4 }
    );
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

test("reads a bounded crawl validator with cached traversal links", async () => {
  const originalFetch = globalThis.fetch;
  const sourceSnapshotId = "01900000-0000-7000-8000-000000000004";
  let requestBody: unknown;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    assert.equal(
      String(input),
      "http://seo-data.test:4001/internal/v1/crawl-snapshots/validators"
    );
    requestBody = JSON.parse(String(init?.body));
    return response({
      data: {
        sourceSnapshotId,
        etag: 'W/"page-v2"',
        lastModified: "Fri, 31 Jul 2026 08:00:00 GMT",
        internalLinks: [
          "https://example.com/about",
          "https://example.com/pricing"
        ]
      },
      meta: { requestId: "crawl-validator-001" }
    });
  }) as typeof fetch;

  try {
    assert.deepEqual(
      await client().validator({
        workspaceId: pageInput.workspaceId,
        projectId: pageInput.projectId,
        url: pageInput.finalUrl
      }),
      {
        sourceSnapshotId,
        etag: 'W/"page-v2"',
        lastModified: "Fri, 31 Jul 2026 08:00:00 GMT",
        internalLinks: [
          "https://example.com/about",
          "https://example.com/pricing"
        ]
      }
    );
    assert.deepEqual(requestBody, {
      workspaceId: pageInput.workspaceId,
      projectId: pageInput.projectId,
      url: pageInput.finalUrl
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects unsafe crawl validator headers and links", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const data of [
      {
        sourceSnapshotId: "01900000-0000-7000-8000-000000000004",
        etag: "bad\r\nX-Injected: yes",
        internalLinks: []
      },
      {
        sourceSnapshotId: "01900000-0000-7000-8000-000000000004",
        etag: '"safe"',
        internalLinks: ["file:///etc/passwd"]
      }
    ]) {
      globalThis.fetch = (async (): Promise<Response> =>
        response({
          data,
          meta: { requestId: "crawl-validator-invalid" }
        })) as typeof fetch;
      await assert.rejects(
        client().validator({
          workspaceId: pageInput.workspaceId,
          projectId: pageInput.projectId,
          url: pageInput.finalUrl
        }),
        /SEO Data crawl response is invalid/u
      );
    }
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
