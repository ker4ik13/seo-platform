import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
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

test("finalizes 5000 pages, all four duplicate kinds and 5000 absences idempotently", { skip: !databaseUrl, timeout: 120_000 }, async (t) => {
  const prisma = new PrismaService(loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl! }));
  const service = new CrawlSnapshotService(prisma);
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const crawlId = randomUUID();
  try {
    await service.persistPage({ ...pageInput(1, "Shared title", "a".repeat(64)), workspaceId, projectId, crawlId, requestedUrl: "https://radar.example.com/large/1", finalUrl: "https://radar.example.com/large/1" });
    await prisma.$executeRaw`
      INSERT INTO pages (workspace_id, project_id, url, normalized_url, url_hash, updated_at)
      SELECT ${workspaceId}::uuid, ${projectId}::uuid,
        'https://radar.example.com/large/' || sequence,
        'https://radar.example.com/large/' || sequence,
        encode(sha256(convert_to('https://radar.example.com/large/' || sequence, 'UTF8')), 'hex'), CURRENT_TIMESTAMP
      FROM generate_series(2, 5000) AS sequence
    `;
    await prisma.$executeRaw`
      INSERT INTO crawl_page_snapshots (
        workspace_id, project_id, crawl_id, sequence, page_id,
        requested_url, final_url, final_url_hash, redirect_chain, in_sitemap,
        depth, status_code, response_time_ms, size_bytes, content_type,
        title, description, h1, h1_count, headings, hreflang, internal_links,
        external_links, image_count, images_missing_alt, structured_data_types,
        word_count, content_hash, indexability, crawled_at
      )
      SELECT ${workspaceId}::uuid, ${projectId}::uuid, ${crawlId}::uuid,
        split_part(page.url, '/large/', 2)::integer, page.id,
        page.url, page.url, page.url_hash, '[]'::jsonb, false,
        0, 200, 250, 4096, 'text/html',
        'Shared title', 'Description', 'Heading', 1, '[]'::jsonb, '[]'::jsonb,
        '[]'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, 100,
        ${"a".repeat(64)}, 'INDEXABLE'::"PageIndexability", CURRENT_TIMESTAMP
      FROM pages page
      WHERE page.project_id = ${projectId}::uuid
        AND page.url <> 'https://radar.example.com/large/1'
    `;
    const input = { workspaceId, projectId, crawlId, status: "COMPLETED" as const, processedUrls: 5000, scopeHash: "e".repeat(64) };
    const receipt = { accepted: true as const, issueCount: 20000 };
    const started = performance.now();
    assert.deepEqual(await service.finalize(input), receipt);
    assert.deepEqual(await service.finalize(input), receipt);
    t.diagnostic(`large finalization ${Math.round(performance.now() - started)} ms`);
    const groups = await service.listDuplicateGroups(workspaceId, projectId, crawlId);
    t.diagnostic(`large groups ${Math.round(performance.now() - started)} ms`);
    assert.deepEqual(groups.groups.map(({ memberCount }) => memberCount), [5000, 5000, 5000, 5000]);
    const missingCrawlId = randomUUID();
    const missingInput = { ...input, crawlId: missingCrawlId, processedUrls: 0 };
    assert.deepEqual(await service.finalize(missingInput), { accepted: true, issueCount: 5000 });
    assert.deepEqual(await service.finalize(missingInput), { accepted: true, issueCount: 5000 });
    t.diagnostic(`large absences ${Math.round(performance.now() - started)} ms`);
    assert.equal((await service.listAbsentPages(workspaceId, projectId, missingCrawlId)).pages.length, 5000);
  } finally { await prisma.$disconnect(); }
});

test("a single-page recheck preserves duplicate issues until a comparable full crawl resolves them", { skip: !databaseUrl, timeout: 15_000 }, async () => {
  const prisma = new PrismaService(loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl! }));
  const service = new CrawlSnapshotService(prisma);
  const scope = { workspaceId: randomUUID(), projectId: randomUUID() };
  const firstCrawl = randomUUID();
  try {
    for (const sequence of [1, 2]) await service.persistPage({ ...duplicatePageInput(sequence), ...scope, crawlId: firstCrawl });
    await service.finalize({ ...scope, crawlId: firstCrawl, status: "COMPLETED", processedUrls: 2, scopeHash: "a".repeat(64) });
    const singleCrawl = randomUUID();
    await service.persistPage({ ...duplicatePageInput(1), ...scope, crawlId: singleCrawl, crawledAt: "2026-10-10T12:00:00.000Z" });
    await service.finalize({ ...scope, crawlId: singleCrawl, status: "COMPLETED", processedUrls: 1, scopeHash: "b".repeat(64) });
    assert.equal((await service.listIssues(scope.workspaceId, scope.projectId)).issues.filter(issue => issue.code.startsWith("DUPLICATE_")).length, 8);
    const finalCrawl = randomUUID();
    for (const sequence of [1, 2]) await service.persistPage({ ...duplicatePageInput(sequence), ...scope, crawlId: finalCrawl, title: `Title ${sequence}`, description: `Description ${sequence}`, h1: `Heading ${sequence}`, contentHash: String(sequence).repeat(64), crawledAt: "2026-10-10T13:00:00.000Z" });
    await service.finalize({ ...scope, crawlId: finalCrawl, status: "COMPLETED", processedUrls: 2, scopeHash: "a".repeat(64) });
    assert.equal((await service.listIssues(scope.workspaceId, scope.projectId)).issues.filter(issue => issue.code.startsWith("DUPLICATE_")).length, 0);
  } finally { await prisma.$disconnect(); }
});

test("new crawl restores archived pages for both fresh and 304 snapshots without losing their identity", { skip: !databaseUrl }, async () => {
  const prisma = new PrismaService(loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl! })), service = new CrawlSnapshotService(prisma);
  const scope = { workspaceId: randomUUID(), projectId: randomUUID() }, actor = randomUUID();
  const snapshot = { ...pageInput(1, "Page", "a".repeat(64)), ...scope, crawlId: randomUUID(), etag: '"stable"', crawledAt: "2026-10-10T12:00:00.000Z" };
  try {
    await service.persistPage(snapshot);
    const page = await prisma.page.findFirstOrThrow({ where: scope });
    const archive = async () => prisma.page.update({ where: { id: page.id }, data: { status: "ARCHIVED", archivedBy: actor, archivedAt: new Date(), notes: "Сохранить заметку", priority: 7, version: { increment: 1 } } });
    await archive();
    await service.persistPage(snapshot);
    assert.equal((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).status, "ARCHIVED", "old receipt replay must not undo a later manual archive");
    const fresh = { ...snapshot, crawlId: randomUUID(), crawledAt: "2026-10-10T12:01:00.000Z" };
    await service.persistPage(fresh);
    let restored = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    assert.equal(restored.status, "ACTIVE"); assert.equal(restored.archivedAt, null); assert.equal(restored.archivedBy, null); assert.equal(restored.notes, "Сохранить заметку"); assert.equal(restored.priority, 7);
    await archive();
    await service.persistPage({ ...snapshot, crawlId: randomUUID(), savePageMap: false, crawledAt: "2026-10-10T12:02:00.000Z" });
    assert.equal((await prisma.page.findUniqueOrThrow({ where: { id: page.id } })).status, "ARCHIVED");
    const validator = await service.validator({ ...scope, url: snapshot.requestedUrl }); assert.ok(validator);
    await service.reusePage({ ...scope, sourceSnapshotId: validator.sourceSnapshotId, crawlId: randomUUID(), sequence: 1, requestedUrl: snapshot.requestedUrl, finalUrl: snapshot.finalUrl, redirectChain: [], inSitemap: true, depth: 0, crawledAt: "2026-10-10T12:03:00.000Z" });
    restored = await prisma.page.findUniqueOrThrow({ where: { id: page.id } });
    assert.equal(restored.status, "ACTIVE"); assert.equal(restored.archivedAt, null); assert.equal(restored.archivedBy, null); assert.equal(restored.notes, "Сохранить заметку");
    assert.equal(await prisma.page.count({ where: scope }), 1); assert.equal(await prisma.crawlPageSnapshot.count({ where: scope }), 4);
  } finally { await prisma.$disconnect(); }
});
