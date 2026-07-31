import assert from "node:assert/strict";
import test from "node:test";
import type { InternalPersistCrawlPageInput } from "@seo-platform/contracts";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { CrawlSnapshotService } from "./crawl-snapshot.service.js";

const databaseUrl = process.env.SEO_DATA_CRAWL_TEST_DATABASE_URL;
const WORKSPACE_ID = "01900000-0000-7000-8000-000000000101";
const PROJECT_ID = "01900000-0000-7000-8000-000000000102";

test(
  "PostgreSQL persists one immutable page change between two crawls",
  { skip: !databaseUrl, timeout: 15_000 },
  async () => {
    const prisma = new PrismaService(
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl!
      })
    );
    const service = new CrawlSnapshotService(prisma);
    try {
      await service.persistPage(pageInput(1, "Title A", "a".repeat(64)));
      assert.deepEqual(await service.listChanges(WORKSPACE_ID, PROJECT_ID), {
        changes: []
      });

      await service.persistPage(pageInput(2, "Title B", "b".repeat(64)));
      const collection = await service.listChanges(
        WORKSPACE_ID,
        PROJECT_ID
      );
      assert.equal(collection.changes.length, 1);
      assert.equal(collection.changes[0]?.severity, "WARNING");
      assert.deepEqual(collection.changes[0]?.changedFields, [
        "title",
        "contentHash"
      ]);

      const stored = await prisma.crawlPageChange.findFirstOrThrow();
      assert.match(stored.beforeHash, /^[0-9a-f]{64}$/u);
      assert.match(stored.afterHash, /^[0-9a-f]{64}$/u);
      assert.notEqual(stored.beforeHash, stored.afterHash);
      await assert.rejects(
        prisma.crawlPageChange.update({
          where: { id: stored.id },
          data: { source: "TECHNICAL_CRAWL" }
        }),
        /immutable/u
      );

      const validator = await service.validator({
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        url: "https://radar.example.com/"
      });
      assert.ok(validator);
      assert.equal(validator.etag, '"radar-v2"');
      assert.deepEqual(validator.internalLinks, []);

      const reuse = await service.reusePage({
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        crawlId: "01900000-0000-7000-8000-000000000113",
        sequence: 1,
        sourceSnapshotId: validator.sourceSnapshotId,
        requestedUrl: "https://radar.example.com/",
        finalUrl: "https://radar.example.com/",
        redirectChain: [],
        inSitemap: true,
        depth: 0,
        crawledAt: "2026-08-01T10:00:00.000Z"
      });
      assert.deepEqual(reuse, {
        accepted: true,
        issueCount: 0,
        success: true
      });
      const reused =
        await prisma.crawlPageSnapshot.findFirstOrThrow({
          where: {
            crawlId: "01900000-0000-7000-8000-000000000113"
          }
        });
      assert.equal(reused.notModified, true);
      assert.equal(reused.reusedFromSnapshotId, validator.sourceSnapshotId);
      assert.equal(reused.contentHash, "b".repeat(64));
      const afterReuse = await service.listChanges(
        WORKSPACE_ID,
        PROJECT_ID
      );
      assert.deepEqual(afterReuse.changes[0]?.changedFields, [
        "inSitemap"
      ]);
    } finally {
      await prisma.$disconnect();
    }
  }
);

function pageInput(
  run: number,
  title: string,
  contentHash: string
): InternalPersistCrawlPageInput {
  return {
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    crawlId:
      run === 1
        ? "01900000-0000-7000-8000-000000000111"
        : "01900000-0000-7000-8000-000000000112",
    sequence: 1,
    requestedUrl: "https://radar.example.com/",
    finalUrl: "https://radar.example.com/",
    redirectChain: [],
    inSitemap: false,
    depth: 0,
    statusCode: 200,
    responseTimeMs: 250,
    sizeBytes: 4_096,
    contentType: "text/html",
    title,
    description: "Description",
    h1: "Heading",
    h1Count: 1,
    canonicalUrl: "https://radar.example.com/",
    robots: "index,follow",
    language: "en",
    headings: [{ level: 1, text: "Heading" }],
    hreflang: [],
    internalLinks: [],
    externalLinks: [],
    imageCount: 0,
    imagesMissingAlt: 0,
    structuredDataTypes: [],
    wordCount: 100,
    contentHash,
    etag: `"radar-v${run}"`,
    lastModified: `Fri, ${29 + run} Jul 2026 10:00:00 GMT`,
    indexability: "INDEXABLE",
    issues: [],
    crawledAt: `2026-07-${29 + run}T10:00:00.000Z`
  };
}
