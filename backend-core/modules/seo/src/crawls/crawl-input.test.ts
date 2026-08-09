import assert from "node:assert/strict";
import test from "node:test";
import {
  internalGetCrawlPageValidatorInput,
  internalPersistCrawlPageInput,
  internalReuseCrawlPageInput
} from "./crawl-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const crawlId = "01900000-0000-7000-8000-000000000003";
const sourceSnapshotId = "01900000-0000-7000-8000-000000000004";

test("parses exact conditional validator and snapshot reuse commands", () => {
  assert.deepEqual(
    internalGetCrawlPageValidatorInput({
      workspaceId,
      projectId,
      url: "HTTPS://Example.COM:443/page"
    }),
    {
      workspaceId,
      projectId,
      url: "https://example.com/page"
    }
  );
  assert.deepEqual(
    internalReuseCrawlPageInput({
      workspaceId,
      projectId,
      crawlId,
      sequence: 2,
      sourceSnapshotId,
      requestedUrl: "https://example.com/page",
      finalUrl: "https://example.com/page",
      redirectChain: [],
      inSitemap: true,
      depth: 1,
      crawledAt: "2026-07-31T10:00:00.000Z"
    }),
    {
      workspaceId,
      projectId,
      crawlId,
      purpose: "TECHNICAL_AUDIT",
      sequence: 2,
      sourceSnapshotId,
      requestedUrl: "https://example.com/page",
      finalUrl: "https://example.com/page",
      redirectChain: [],
      inSitemap: true,
      depth: 1,
      crawledAt: "2026-07-31T10:00:00.000Z",
      savePageMap: true
    }
  );
});

test("accepts bounded response validators and rejects header injection", () => {
  const input = pageInput();
  assert.equal(
    internalPersistCrawlPageInput({
      ...input,
      etag: 'W/"content-v2"',
      lastModified: "Fri, 31 Jul 2026 08:00:00 GMT"
    }).etag,
    'W/"content-v2"'
  );
  for (const value of [
    { ...input, etag: "bad\r\nX-Injected: yes" },
    { ...input, lastModified: "x".repeat(129) }
  ]) {
    assert.throws(
      () => internalPersistCrawlPageInput(value),
      /Invalid crawl/u
    );
  }
});

test("accepts bounded meta tags and the expanded crawl sequence", () => {
  const parsed = internalPersistCrawlPageInput({
    ...pageInput(),
    sequence: 5_000,
    savePageMap: false,
    metaTags: [
      { name: "description", content: "Описание" },
      { property: "og:title", content: "Заголовок" }
    ]
  });
  assert.equal(parsed.sequence, 5_000);
  assert.equal(parsed.savePageMap, false);
  assert.deepEqual(parsed.metaTags, [
    { name: "description", content: "Описание" },
    { property: "og:title", content: "Заголовок" }
  ]);
  assert.throws(() =>
    internalPersistCrawlPageInput({ ...pageInput(), sequence: 5_001 })
  );
});

function pageInput(): Readonly<Record<string, unknown>> {
  return {
    workspaceId,
    projectId,
    crawlId,
    sequence: 1,
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    redirectChain: [],
    inSitemap: false,
    depth: 0,
    statusCode: 200,
    responseTimeMs: 100,
    sizeBytes: 1_024,
    contentType: "text/html",
    h1Count: 1,
    headings: [],
    hreflang: [],
    internalLinks: [],
    externalLinks: [],
    imageCount: 0,
    imagesMissingAlt: 0,
    structuredDataTypes: [],
    wordCount: 10,
    contentHash: "a".repeat(64),
    indexability: "INDEXABLE",
    issues: [],
    crawledAt: "2026-07-31T10:00:00.000Z"
  };
}
