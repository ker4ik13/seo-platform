import { PageInsightsService } from "./page-insights.service.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import { PageService } from "./page.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const pageId = "01900000-0000-7000-8000-000000000004";

test("combines site-structure navigation with independent text search", async () => {
  const listQueries: Array<{ readonly where?: unknown; readonly take?: number }> = [];
  const prefixQueries: Array<{ readonly sql: string; readonly values: readonly unknown[] }> = [];
  const service = makePageService({
    $queryRaw: async (query: { readonly sql: string; readonly values: readonly unknown[] }) => { prefixQueries.push(query); return []; },
    page: {
      findMany: async (input: { readonly where?: unknown; readonly take?: number }) => {
        listQueries.push(input);
        return [];
      }
    }
  } as unknown as PrismaService);

  await service.list(workspaceId, projectId, {
    limit: 50,
    lifecycleStatus: "ACTIVE",
    search: "товар",
    pathPrefix: "/catalog/"
  });

  const pageQuery = listQueries.find(({ take }) => take === 51);
  const where = pageQuery?.where as { readonly AND?: readonly unknown[] };
  assert.equal(where.AND?.length, 1);
  assert.equal(prefixQueries.length, 1);
  assert.ok(prefixQueries[0]?.values.includes("^https?://[^/?#]+/catalog(?:/|[?#]|$)"));
  assert.ok(prefixQueries[0]?.values.includes("%товар%"));
  assert.ok(prefixQueries[0]?.values.includes(51));
});

test("promotes a hidden crawl backing page instead of creating a duplicate URL", async () => {
  const pageUpdates: unknown[] = [];
  const sourceUpserts: unknown[] = [];
  let createCalls = 0;
  const aggregate = pageAggregate();
  const transaction = {
    $executeRaw: async () => 1,
    pageCreateReceipt: {
      findUnique: async () => null,
      create: async () => ({ id: "receipt" })
    },
    page: {
      findUnique: async () => ({
        id: pageId,
        includedInMap: false,
        status: "ACTIVE" as const
      }),
      create: async () => {
        createCalls += 1;
        return { id: pageId };
      },
      update: async (input: unknown) => {
        pageUpdates.push(input);
        return { id: pageId };
      },
      findFirst: async () => aggregate
    },
    pageSource: {
      upsert: async (input: unknown) => {
        sourceUpserts.push(input);
        return { pageId };
      }
    }
  };
  const service = makePageService({
    pageCreateReceipt: { findUnique: async () => null },
    $transaction: async (
      callback: (client: typeof transaction) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService);

  const result = await service.create({
    workspaceId,
    projectId,
    actorId,
    idempotencyKey: "page-create-hidden-promotion-001",
    url: "https://example.com/catalog",
    aliases: [],
    pageType: "EXISTING",
    indexability: "INDEXABLE",
    priority: 0
  });

  assert.equal(result.id, pageId);
  assert.equal(createCalls, 0);
  assert.equal(pageUpdates.length, 1);
  assert.equal(sourceUpserts.length, 1);
  assert.equal(
    (pageUpdates[0] as { data: { includedInMap: boolean } }).data.includedInMap,
    true
  );
});

function pageAggregate() {
  const timestamp = new Date("2026-08-09T10:00:00.000Z");
  return {
    id: pageId,
    workspaceId,
    projectId,
    url: "https://example.com/catalog",
    normalizedUrl: "https://example.com/catalog",
    urlHash: "a".repeat(64),
    pageType: "EXISTING" as const,
    indexability: "INDEXABLE" as const,
    httpStatus: 200,
    canonicalTarget: null,
    robots: null,
    title: "Каталог",
    description: null,
    h1: "Каталог",
    language: "ru",
    template: null,
    contentStatus: null,
    ownerId: null,
    priority: 0,
    publishedAt: null,
    crawledAt: timestamp,
    analyticsMetrics: {},
    includedInMap: true,
    notes: null,
    status: "ACTIVE" as const,
    version: 2,
    createdBy: actorId,
    updatedBy: actorId,
    archivedBy: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    aliases: [],
    sources: [
      { source: "MANUAL" as const, firstSeenAt: timestamp, lastSeenAt: timestamp }
    ],
    crawlSnapshots: [],
    _count: { targetKeywords: 0, primaryClusters: 0, crawlIssues: 0 }
  };
}

function makePageService(prisma: PrismaService) { return new PageService(prisma, new PageInsightsService(prisma)); }
