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

      await service.persistPage(duplicatePageInput(1));
      await service.persistPage(duplicatePageInput(2));
      const finalization = {
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        crawlId: "01900000-0000-7000-8000-000000000114",
        status: "COMPLETED" as const,
        processedUrls: 2,
        scopeHash: "c".repeat(64)
      };
      assert.deepEqual(await service.finalize(finalization), {
        accepted: true,
        issueCount: 8
      });
      const duplicateGroups = await service.listDuplicateGroups(
        WORKSPACE_ID,
        PROJECT_ID,
        finalization.crawlId
      );
      assert.deepEqual(
        duplicateGroups.groups.map(({ kind, memberCount }) => ({
          kind,
          memberCount
        })),
        [
          { kind: "CONTENT", memberCount: 2 },
          { kind: "TITLE", memberCount: 2 },
          { kind: "DESCRIPTION", memberCount: 2 },
          { kind: "H1", memberCount: 2 }
        ]
      );
      assert.deepEqual(await service.finalize(finalization), {
        accepted: true,
        issueCount: 8
      });
      assert.equal(
        await prisma.crawlIssueOccurrence.count({
          where: {
            snapshot: { crawlId: finalization.crawlId },
            code: { startsWith: "DUPLICATE_" }
          }
        }),
        8
      );
      await assert.rejects(
        prisma.crawlDuplicateGroup.update({
          where: { id: duplicateGroups.groups[0]!.id },
          data: { memberCount: 3 }
        }),
        /immutable/u
      );

      const partialCrawlId =
        "01900000-0000-7000-8000-000000000117";
      await service.persistPage({
        ...duplicatePageInput(1),
        crawlId: partialCrawlId,
        crawledAt: "2026-07-31T08:30:01.000Z"
      });
      assert.deepEqual(
        await service.finalize({
          ...finalization,
          crawlId: partialCrawlId,
          status: "PARTIALLY_COMPLETED",
          processedUrls: 1
        }),
        { accepted: true, issueCount: 0 }
      );
      assert.deepEqual(
        await service.listAbsentPages(
          WORKSPACE_ID,
          PROJECT_ID,
          partialCrawlId
        ),
        { crawlId: partialCrawlId, pages: [] }
      );

      const changedScopeCrawlId =
        "01900000-0000-7000-8000-000000000118";
      await service.persistPage({
        ...duplicatePageInput(1),
        crawlId: changedScopeCrawlId,
        crawledAt: "2026-07-31T08:45:01.000Z"
      });
      assert.deepEqual(
        await service.finalize({
          ...finalization,
          crawlId: changedScopeCrawlId,
          processedUrls: 1,
          scopeHash: "d".repeat(64)
        }),
        { accepted: true, issueCount: 0 }
      );
      assert.deepEqual(
        await service.listAbsentPages(
          WORKSPACE_ID,
          PROJECT_ID,
          changedScopeCrawlId
        ),
        { crawlId: changedScopeCrawlId, pages: [] }
      );

      const missingCrawlId =
        "01900000-0000-7000-8000-000000000115";
      await service.persistPage({
        ...duplicatePageInput(1),
        crawlId: missingCrawlId,
        crawledAt: "2026-07-31T09:00:01.000Z"
      });
      assert.deepEqual(
        await service.finalize({
          ...finalization,
          crawlId: missingCrawlId,
          processedUrls: 1
        }),
        { accepted: true, issueCount: 1 }
      );
      const absences = await service.listAbsentPages(
        WORKSPACE_ID,
        PROJECT_ID,
        missingCrawlId
      );
      assert.deepEqual(absences, {
        crawlId: missingCrawlId,
        pages: [{
          pageId: duplicateGroups.groups[0]!.members[1]!.pageId,
          url: "https://radar.example.com/duplicate-2",
          previousCrawlId: finalization.crawlId,
          previousSnapshotId:
            (await prisma.crawlPageSnapshot.findFirstOrThrow({
              where: {
                crawlId: finalization.crawlId,
                sequence: 2
              },
              select: { id: true }
            })).id,
          wasInSitemap: false,
          lastSeenAt: "2026-07-31T08:00:02.000Z",
          detectedAt: absences.pages[0]!.detectedAt
        }]
      });
      assert.equal(
        (await service.listIssues(WORKSPACE_ID, PROJECT_ID)).issues.some(
          ({ code, pageId }) =>
            code === "URL_DISAPPEARED_FROM_CRAWL" &&
            pageId === absences.pages[0]!.pageId
        ),
        true
      );
      await assert.rejects(
        prisma.crawlPageAbsence.update({
          where: {
            workspaceId_projectId_crawlId_pageId: {
              workspaceId: WORKSPACE_ID,
              projectId: PROJECT_ID,
              crawlId: missingCrawlId,
              pageId: absences.pages[0]!.pageId
            }
          },
          data: { detectedAt: new Date() }
        }),
        /immutable/u
      );

      const restoredCrawlId =
        "01900000-0000-7000-8000-000000000116";
      await service.persistPage({
        ...duplicatePageInput(1),
        crawlId: restoredCrawlId,
        crawledAt: "2026-07-31T10:00:01.000Z"
      });
      await service.persistPage({
        ...duplicatePageInput(2),
        crawlId: restoredCrawlId,
        crawledAt: "2026-07-31T10:00:02.000Z"
      });
      assert.deepEqual(
        await service.finalize({
          ...finalization,
          crawlId: restoredCrawlId
        }),
        { accepted: true, issueCount: 8 }
      );
      assert.equal(
        (await service.listIssues(WORKSPACE_ID, PROJECT_ID)).issues.some(
          ({ code }) => code === "URL_DISAPPEARED_FROM_CRAWL"
        ),
        false
      );
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

function duplicatePageInput(
  sequence: number
): InternalPersistCrawlPageInput {
  const url = `https://radar.example.com/duplicate-${sequence}`;
  return {
    ...pageInput(2, "Duplicate title", "c".repeat(64)),
    crawlId: "01900000-0000-7000-8000-000000000114",
    sequence,
    requestedUrl: url,
    finalUrl: url,
    title: sequence === 1 ? " Duplicate   title " : "duplicate title",
    description: "Duplicate description",
    h1: "Duplicate heading",
    canonicalUrl: url,
    etag: `"duplicate-${sequence}"`,
    crawledAt: `2026-07-31T08:00:0${sequence}.000Z`
  };
}
