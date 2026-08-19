import assert from "node:assert/strict";
import test from "node:test";
import { semanticFrequencyTypes } from "@seo-platform/contracts";
import type { PrismaService } from "../database/prisma.service.js";
import { OperationResultService } from "./operation-result.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const crawlId = "01900000-0000-7000-8000-000000000005";
const context = { workspaceId, projectId, actorId };

test("returns AI answer rows with per-job snapshot state", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000010";
  const service = new OperationResultService({
    keyword: {
      findMany: async () => [{ id: keywordId, textOriginal: "подбор подшипника" }]
    },
    aiAnswerSnapshot: {
      findMany: async () => [{
        keywordId,
        answerPresent: true,
        siteFound: true,
        position: 2,
        rankingUrl: "https://example.com/bearing",
        brandFound: false,
        observedAt: new Date("2026-08-19T12:00:00.000Z"),
        _count: { sources: 4 }
      }]
    }
  } as unknown as PrismaService);

  const result = await service.aiAnswer({
    workspaceId,
    projectId,
    actorId,
    jobId,
    keywordIds: [keywordId]
  });

  assert.deepEqual(result.rows, [{
    keywordId,
    keyword: "подбор подшипника",
    snapshot: {
      answerPresent: true,
      siteFound: true,
      position: 2,
      rankingUrl: "https://example.com/bearing",
      brandFound: false,
      sourceCount: 4,
      observedAt: "2026-08-19T12:00:00.000Z"
    }
  }]);
});

test("returns exact FOUND, NOT_FOUND and PENDING rank rows", async () => {
  let observedWhere: unknown;
  const entries = [
    rankEntry(0, null),
    rankEntry(1, {
      found: true,
      position: 7,
      absolutePosition: 9,
      pixelPosition: 640,
      rankingUrl: "https://example.com/found",
      title: "Found title",
      snippet: "Found snippet",
      observedAt: new Date("2026-08-02T10:00:00.000Z"),
      dataQualityFlags: []
    }),
    rankEntry(2, {
      found: false,
      position: null,
      absolutePosition: null,
      pixelPosition: null,
      rankingUrl: null,
      title: null,
      snippet: null,
      observedAt: new Date("2026-08-02T10:01:00.000Z"),
      dataQualityFlags: []
    })
  ];
  const service = new OperationResultService({
    rankExecutionManifest: {
      findFirst: async ({ where }: { where: unknown }) => {
        observedWhere = where;
        return {
          id: "01900000-0000-7000-8000-000000000007",
          trackingContextId: "01900000-0000-7000-8000-000000000006",
          execution: execution(),
          context: { name: "Google · Москва · Десктоп" }
        };
      }
    },
    rankExecutionManifestEntry: {
      findMany: async ({ where }: { where: { sequence?: { gt: number } } }) => {
        const sequenceFilter = where.sequence;
        return sequenceFilter
          ? entries.filter(({ sequence }) => sequence > sequenceFilter.gt)
          : entries;
      }
    }
  } as unknown as PrismaService);

  const first = await service.rank(context, jobId, 2);
  const second = await service.rank(context, jobId, 2, 1);
  const rows = [...first.rows, ...second.rows];

  assert.deepEqual(observedWhere, { workspaceId, projectId, jobId });
  assert.deepEqual(
    rows.map(({ state }) => state),
    ["PENDING", "FOUND", "NOT_FOUND"]
  );
  assert.deepEqual(first.page, { hasNext: true, nextCursor: "1" });
  assert.deepEqual(second.page, { hasNext: false });
  assert.equal(rows[1]?.position, 7);
  assert.equal(rows[1]?.rankingUrl, "https://example.com/found");
  assert.equal(rows[2]?.observedAt, "2026-08-02T10:01:00.000Z");
});

test("paginates crawl rows by immutable sequence and supports an empty page", async () => {
  const calls: unknown[] = [];
  const pages = [
    [crawlRow(0), crawlRow(1), crawlRow(2)],
    []
  ];
  const service = new OperationResultService({
    crawlPageSnapshot: {
      findMany: async (input: unknown) => {
        calls.push(input);
        return pages.shift() ?? [];
      }
    }
  } as unknown as PrismaService);

  const first = await service.crawl(context, crawlId, 2);
  const empty = await service.crawl(context, crawlId, 2, 1);

  assert.equal(first.rows.length, 2);
  assert.deepEqual(first.page, { hasNext: true, nextCursor: "1" });
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(empty.page, { hasNext: false });
  assert.deepEqual(
    (calls[1] as { where: unknown }).where,
    {
      workspaceId,
      projectId,
      crawlId,
      sequence: { gt: 1 }
    }
  );
});

test("fails closed when a frequency result exceeds the bounded projection", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000010";
  const snapshots = Array.from({
    length: semanticFrequencyTypes.length + 1
  }, (_, index) => ({
    keywordId,
    type: "BASE",
    regionCode: "213",
    device: "ALL",
    period: null,
    value: BigInt(index),
    provider: "ARSENKIN",
    sourceMode: "BYOK",
    jobId,
    qualityFlags: [],
    observedAt: new Date("2026-08-02T10:00:00.000Z")
  }));
  const service = new OperationResultService({
    keyword: {
      findMany: async () => [{ id: keywordId, textOriginal: "seo аудит" }]
    },
    frequencySnapshot: { findMany: async () => snapshots }
  } as unknown as PrismaService);

  await assert.rejects(
    () =>
      service.frequency({
        workspaceId,
        projectId,
        actorId,
        jobId,
        keywordIds: [keywordId]
      }),
    /frequency result is oversized/u
  );
});

function execution() {
  return {
    searchEngine: "GOOGLE",
    countryCode: "RU",
    regionCode: "213",
    language: "ru",
    device: "DESKTOP",
    depth: 30,
    domainMatchRule: { mode: "EXACT_HOST" },
    safeSearch: false,
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE",
    providerMappingVersion: "arsenkin-positions@1"
  };
}

function rankEntry(sequence: number, rankSnapshot: unknown) {
  const suffix = String(sequence + 20).padStart(12, "0");
  return {
    sequence,
    keywordId: `01900000-0000-7000-8000-${suffix}`,
    keyword: { textOriginal: `Keyword ${sequence + 1}` },
    rankSnapshot
  };
}

function crawlRow(sequence: number) {
  return {
    sequence,
    requestedUrl: `https://example.com/requested-${sequence}`,
    finalUrl: `https://example.com/final-${sequence}`,
    redirectChain: [],
    statusCode: 200,
    responseTimeMs: 120,
    sizeBytes: 1_024,
    contentType: "text/html",
    title: `Page ${sequence}`,
    h1: null,
    canonicalUrl: null,
    indexability: sequence === 1 ? "BLOCKED_ROBOTS" : "INDEXABLE",
    inSitemap: true,
    depth: 1,
    wordCount: 300,
    internalLinks: ["https://example.com/internal"],
    externalLinks: [],
    crawledAt: new Date("2026-08-02T10:00:00.000Z"),
    issueOccurrences: []
  };
}
