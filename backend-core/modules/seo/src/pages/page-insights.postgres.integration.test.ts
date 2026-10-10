import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import type { InternalPersistCrawlPageInput, SemanticImportPublishRow } from "@seo-platform/contracts";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { SemanticImportService } from "../semantic-imports/semantic-import.service.js";
import { CrawlSnapshotService } from "../crawls/crawl-snapshot.service.js";
import { PageService } from "./page.service.js";
import { PageInsightsService } from "./page-insights.service.js";

const databaseUrl = process.env.SEO_PAGE_INSIGHTS_TEST_DATABASE_URL;
test("real PostgreSQL page statistics, evidence, panels and URL path boundaries", { skip: !databaseUrl, timeout: 90_000 }, async () => {
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname) && target.port && target.port !== "5432", "Isolated PostgreSQL only");
  const prisma = new PrismaService(loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl }));
  try {
    const scope = { workspaceId: randomUUID(), projectId: randomUUID(), actorId: randomUUID() }, domain = "page-insights.example.invalid", base = `https://${domain}`, importId = randomUUID();
    const importer = new SemanticImportService(prisma), input = { ...scope, importId, projectDomain: domain };
    const normalized = await importer.normalizeKeywords({ ...input, rows: Array.from({ length: 5 }, (_, index) => ({ rowNumber: String(index + 1), text: `Ключ ${index + 1}`, language: "ru" })) });
    const rows: SemanticImportPublishRow[] = normalized.rows.map((row, index) => ({ sourceRowNumber: String(index + 1), textOriginal: row.textOriginal, textNormalized: row.textNormalized, normalizedHash: row.normalizedHash, language: "ru", customValues: {}, isTracked: true, targetUrl: `${base}/services/`, groupPath: ["Услуги", "Группа"], positionHistory: index === 4 ? [] : [{ source: "KEY_COLLECTOR", searchEngine: "YANDEX", countryCode: "RU", regionCode: "213", regionLabel: "Москва", language: "ru", device: "DESKTOP", observedAt: "2026-10-08T12:00:00.000Z", found: index !== 3, ...(index === 3 ? {} : { position: [4, 9, 20][index]!, rankingUrl: index === 2 ? `${base}/other/` : `${base}/services/` }) }] }));
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    await importer.begin({ ...input, mappingHash: digest("page-insights"), duplicatePolicy: "MERGE_NON_EMPTY", createMissingKeywords: true, expectedChunks: 1, expectedUniqueRows: "5", expectedNewKeywords: "5", entitlement: { planCode: "LOCAL_TEST", planVersion: 1, storedKeywords: 1_000, keywordsPerProject: 1_000, foldersPerProject: 100, trackedContextPairs: 1_000 } });
    await importer.applyChunk({ ...input, chunkIndex: 0, payloadHash: digest(JSON.stringify({ projectDomain: domain, rows })), duplicatePolicy: "MERGE_NON_EMPTY", createMissingKeywords: true, rows });
    const page = await prisma.page.findFirstOrThrow({ where: { ...withoutActor(scope), normalizedUrl: `${base}/services/` } });
    const reports = new PageInsightsService(prisma), pages = makePageService(prisma), query = { pageIds: [page.id], dimensionKey: "YANDEX|RU|213|ru|DESKTOP", date: "2026-10-08" };
    const statistics = await reports.statistics(scope, query), stat = statistics.pages[0]!;
    assert.deepEqual([stat.assignedCount, stat.measuredCount, stat.matchedCount, stat.notFoundCount, stat.differentPageCount, stat.top10Count, stat.averagePosition], [5, 4, 2, 1, 1, 2, 6.5]);
    assert.equal((await reports.statistics(scope, { ...query, date: "latest" })).date, "2026-10-08");
    assert.equal((await reports.statistics(scope, { ...query, date: "2026-10-09" })).pages[0]?.averagePosition, undefined);
    assert.equal((await reports.statistics(scope, { ...query, dimensionKey: "GOOGLE|RU|1011969|ru|DESKTOP" })).pages[0]?.measuredCount, 0);
    const first = await reports.panel(scope, page.id, { section: "SEMANTICS", limit: 2, dimensionKey: query.dimensionKey, date: query.date });
    assert.equal(first.keywords?.length, 2); assert.ok(first.nextCursor); assert.ok(first.keywords?.every((row) => row.groupPaths.length === 1));
    const next = await reports.panel(scope, page.id, { section: "SEMANTICS", limit: 2, dimensionKey: query.dimensionKey, date: query.date, cursor: first.nextCursor! });
    assert.equal(next.keywords?.length, 2); assert.equal(new Set([...first.keywords!, ...next.keywords!].map((row) => row.id)).size, 4);
    await assert.rejects(reports.panel({ ...scope, projectId: randomUUID() }, page.id, { section: "HISTORY", limit: 10 }), /not found/iu);
    await assert.rejects(reports.panel(scope, page.id, { section: "LINKS", limit: 10, cursor: first.nextCursor! }), /cursor/iu);
    await assert.rejects(reports.statistics({ ...scope, workspaceId: randomUUID() }, query), /not found/iu);

    const snapshots = new CrawlSnapshotService(prisma), crawlId = randomUUID();
    const snapshot: InternalPersistCrawlPageInput = { ...withoutActor(scope), crawlId, sequence: 1, requestedUrl: `${base}/services/`, finalUrl: `${base}/services/`, redirectChain: [], inSitemap: true, depth: 0, statusCode: 200, responseTimeMs: 120, sizeBytes: 1_024, contentType: "text/html", title: "Сервис", h1: "Услуги", h1Count: 1, headings: [{ level: 1, text: "Услуги" }], hreflang: [], internalLinks: [`${base}/services/`], externalLinks: [], imageCount: 2, imagesMissingAlt: 1, structuredDataTypes: ["Service"], metaTags: [{ httpEquiv: "X-Robots-Tag", source: "HTTP", content: "googlebot: noindex" }], wordCount: 300, contentHash: digest("service"), indexability: "NOINDEX", issues: [], crawledAt: "2026-10-09T11:00:00.000Z", etag: '"v1"', technicalDetails: { responseHeadersCaptured: true, links: [{ url: `${base}/services/`, anchor: "Услуги", rel: ["nofollow"], kind: "INTERNAL" }] } };
    await snapshots.persistPage(snapshot);
    const detail = await pages.get(scope.workspaceId, scope.projectId, page.id);
    assert.equal(detail.latestCrawl?.technicalDetails?.responseHeadersCaptured, true); assert.equal(detail.latestCrawl?.headings?.[0]?.text, "Услуги"); assert.equal(detail.latestCrawl?.metaTags[0]?.source, "HTTP");
    assert.equal("links" in detail.latestCrawl!.technicalDetails!, false, "list and overview do not fetch link evidence");
    assert.equal((await reports.panel(scope, page.id, { section: "LINKS", direction: "INTERNAL", limit: 10 })).links?.[0]?.anchor, "Услуги");
    assert.equal((await reports.panel(scope, page.id, { section: "HISTORY", limit: 10 })).history?.length, 1);
    await snapshots.persistPage({ ...snapshot, crawlId: randomUUID(), statusCode: 0, responseTimeMs: 0, sizeBytes: 0, indexability: "BLOCKED_ROBOTS", contentType: "application/x-robots-blocked", metaTags: [], headings: [], technicalDetails: { robotsAccess: [{ agent: "seoplatformcrawler", allowed: false, group: "*", rule: "Disallow: /services/", sourceUrl: `${base}/robots.txt` }] }, crawledAt: "2026-10-09T12:00:00.000Z" });
    assert.equal((await pages.get(scope.workspaceId, scope.projectId, page.id)).latestCrawl?.statusCode, 0);

    for (const url of [`${base}/services?x=1`, `${base}/catalog?next=/services/`]) await pages.create({ ...scope, idempotencyKey: `path-${randomUUID()}`, url, aliases: [], pageType: "EXISTING", indexability: "UNKNOWN", priority: 0 });
    const prefix = await pages.list(scope.workspaceId, scope.projectId, { limit: 100, pathPrefix: "/services/" });
    assert.equal(prefix.pages.length, 2); assert.ok(prefix.pages.every((page) => new URL(page.normalizedUrl).pathname.replace(/\/$/u, "") === "/services"));
    for (const path of ["new", "other", "third"]) await pages.create({ ...scope, idempotencyKey: `child-${randomUUID()}`, url: `${base}/services/${path}/`, aliases: [], pageType: "EXISTING", indexability: "UNKNOWN", priority: 0 });
    // The old root remains first even though descendants and URL variants were modified later.
    const firstPage = await pages.list(scope.workspaceId, scope.projectId, { limit: 1, pathPrefix: "/services/" });
    assert.equal(firstPage.pages[0]?.id, page.id);
    const paginatedIds = firstPage.pages.map((entry) => entry.id);
    let nextCursor = firstPage.nextCursor;
    while (nextCursor) {
      const batch = await pages.list(scope.workspaceId, scope.projectId, { limit: 1, pathPrefix: "/services/", cursor: nextCursor });
      paginatedIds.push(...batch.pages.map((entry) => entry.id)); nextCursor = batch.nextCursor;
    }
    assert.equal(paginatedIds.length, 5); assert.equal(new Set(paginatedIds).size, 5);

    for (const sort of ["URL", "HTTP", "INDEXABILITY", "KEYWORDS", "TITLE", "H1", "RESPONSE_TIME", "SIZE", "ISSUES", "AVERAGE_POSITION"] as const) {
      for (const sortDirection of ["ASC", "DESC"] as const) {
        const options = { limit: 1, sort, sortDirection, includeStructure: false, ...(sort === "AVERAGE_POSITION" ? { dimensionKey: query.dimensionKey, date: query.date } : {}) };
        const ids: string[] = []; let cursor: string | undefined;
        do { const batch = await pages.list(scope.workspaceId, scope.projectId, { ...options, ...(cursor ? { cursor } : {}) }); ids.push(...batch.pages.map(row => row.id)); cursor = batch.nextCursor; assert.equal(batch.structureUrls, undefined); } while (cursor);
        assert.equal(ids.length, 6, `${sort} ${sortDirection}`); assert.equal(new Set(ids).size, 6);
        if (sort === "AVERAGE_POSITION") assert.equal(ids[0], page.id, "missing ranks remain last in both directions");
      }
    }
    const scopedSorted = await pages.list(scope.workspaceId, scope.projectId, { limit: 1, sort: "URL", pathPrefix: "/services/" });
    assert.equal(scopedSorted.pages[0]?.id, page.id);
    await assert.rejects(pages.list(scope.workspaceId, scope.projectId, { limit: 1, sort: "HTTP", cursor: scopedSorted.nextCursor! }), /cursor/iu);

    const prepared = await pages.prepareStatus({ ...scope, input: { operation: "archive", pathPrefix: "/services" } });
    assert.ok(prepared.includes(page.id));
    await assert.rejects(pages.applyStatus({ ...scope, input: { operation: "archive", pageIds: [page.id, randomUUID()] } }));
    assert.equal((await pages.get(scope.workspaceId, scope.projectId, page.id)).lifecycleStatus, "ACTIVE");
    const protectedCluster = await prisma.cluster.create({ data: { workspaceId: scope.workspaceId, projectId: scope.projectId, name: "Основной кластер", method: "MANUAL", primaryPageId: page.id } });
    assert.deepEqual(await pages.applyStatus({ ...scope, input: { operation: "archive", pageIds: [page.id] } }), { changed: 0, blocked: 1 });
    await prisma.cluster.delete({ where: { id: protectedCluster.id } });
    assert.deepEqual(await pages.applyStatus({ ...scope, input: { operation: "archive", pageIds: [page.id] } }), { changed: 1, blocked: 0 });
    assert.deepEqual(await pages.applyStatus({ ...scope, input: { operation: "archive", pageIds: [page.id] } }), { changed: 1, blocked: 0 });
    assert.ok((await pages.list(scope.workspaceId, scope.projectId, { lifecycleStatus: "ARCHIVED", limit: 100 })).structureUrls?.includes(page.normalizedUrl));
    assert.deepEqual(await pages.applyStatus({ ...scope, input: { operation: "restore", pageIds: [page.id] } }), { changed: 1, blocked: 0 });
  } finally { await prisma.$disconnect(); }
});
function withoutActor(scope: Readonly<{ workspaceId: string; projectId: string; actorId: string }>) { return { workspaceId: scope.workspaceId, projectId: scope.projectId }; }

function makePageService(prisma: PrismaService) { return new PageService(prisma, new PageInsightsService(prisma)); }
