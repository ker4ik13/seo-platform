import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  scopedProjectPage,
  scopedProjectPageCollection
} from "./page-response.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const pageId = "01900000-0000-7000-8000-000000000003";

const page = {
  id: pageId,
  workspaceId,
  projectId,
  url: "https://example.com/",
  normalizedUrl: "https://example.com/",
  aliases: [],
  sources: [
    {
      source: "MANUAL",
      firstSeenAt: "2026-07-30T10:00:00.000Z",
      lastSeenAt: "2026-07-30T10:00:00.000Z"
    }
  ],
  pageType: "EXISTING",
  indexability: "INDEXABLE",
  httpStatus: 200,
  priority: 10,
  analyticsMetrics: {},
  assignedKeywordCount: 3,
  assignedClusterCount: 2,
  lifecycleStatus: "ACTIVE",
  version: 1,
  createdAt: "2026-07-30T10:00:00.000Z",
  updatedAt: "2026-07-30T10:00:00.000Z"
};

test("accepts exact tenant-scoped page responses", () => {
  assert.equal(
    scopedProjectPage(page, workspaceId, projectId, pageId).id,
    pageId
  );
  assert.deepEqual(
    scopedProjectPageCollection(
      {
        pages: [page],
        nextCursor: "cursor_page_1",
        structureUrls: ["https://example.com/", "https://example.com/catalog"]
      },
      workspaceId,
      projectId
    ).structureUrls,
    ["https://example.com/", "https://example.com/catalog"]
  );
});

test("accepts bounded latest crawl evidence for the page inspector", () => {
  const result = scopedProjectPage(
    {
      ...page,
      openIssueCount: 2,
      latestCrawl: {
        crawlId: "01900000-0000-7000-8000-000000000004",
        statusCode: 200,
        responseTimeMs: 125,
        sizeBytes: 4096,
        contentType: "text/html",
        title: "Главная",
        description: "Описание",
        h1: "Главная",
        h1Count: 1,
        canonicalUrl: "https://example.com/",
        robots: "index,follow",
        language: "ru",
        metaTags: [
          { property: "og:title", content: "Главная" }
        ],
        imageCount: 3,
        imagesMissingAlt: 1,
        structuredDataTypes: ["Organization"],
        wordCount: 500,
        redirectChain: [],
        inSitemap: true,
        depth: 0,
        indexability: "INDEXABLE",
        crawledAt: "2026-08-09T10:00:00.000Z"
      }
    },
    workspaceId,
    projectId,
    pageId
  );

  assert.equal(result.openIssueCount, 2);
  assert.equal(result.latestCrawl?.metaTags[0]?.property, "og:title");
});

test("rejects cross-tenant and response-shape drift", () => {
  assert.throws(
    () =>
      scopedProjectPage(
        { ...page, workspaceId: "01900000-0000-7000-8000-000000000009" },
        workspaceId,
        projectId
      ),
    DomainError
  );
  assert.throws(
    () =>
      scopedProjectPage(
        { ...page, secret: "must-not-pass" },
        workspaceId,
        projectId
      ),
    DomainError
  );
});
