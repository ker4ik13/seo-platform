import assert from "node:assert/strict";
import test from "node:test";
import { semanticFrequencyTypes } from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import { OperationResultService } from "./operation-result.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const crawlId = "01900000-0000-7000-8000-000000000005";
const context = { workspaceId, projectId, actorId };

test("frequency retry metadata uses current active versions and preserves other rows after deletion", async () => {
  const service = new OperationResultService({ keyword: { findMany: async () => [{ id: "active", textOriginal: "Текущая фраза", version: 9, status: "ACTIVE" }, { id: "trash", textOriginal: "В корзине", version: 12, status: "TRASHED" }] }, frequencySnapshot: { findMany: async () => [] }, frequencySeasonalityPoint: { findMany: async () => [] } } as never);
  const result = await service.frequency({ ...context, jobId, keywordIds: ["active", "deleted", "trash"] });
  assert.deepEqual(result.rows.map(row => ({ id: row.keywordId, version: row.keywordVersion, available: row.keywordAvailable })), [
    { id: "active", version: 9, available: true }, { id: "deleted", version: undefined, available: false }, { id: "trash", version: undefined, available: true }
  ]);
  assert.equal(result.rows[0]?.keyword, "Текущая фраза");
});

test("returns a small seasonality share without exponent notation", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000010";
  const service = new OperationResultService({
    keyword: {
      findMany: async () => [{
        id: keywordId,
        textOriginal: "библиотека промптов",
        version: 2,
        status: "ACTIVE"
      }]
    },
    frequencySnapshot: { findMany: async () => [] },
    frequencySeasonalityPoint: {
      findMany: async () => [{
        keywordId,
        type: "BASE",
        granularity: "MONTH",
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
        value: 3n,
        share: new Prisma.Decimal("0.000000257707063906"),
        regionCode: "213",
        device: "ALL",
        provider: "XMLSTOCK",
        sourceMode: "BYOK",
        jobId,
        observedAt: new Date("2026-09-09T19:18:16.790Z")
      }]
    }
  } as unknown as PrismaService);

  const result = await service.frequency({
    workspaceId,
    projectId,
    actorId,
    jobId,
    keywordIds: [keywordId]
  });

  assert.equal(
    result.rows[0]?.seasonality[0]?.share,
    "0.000000257707063906"
  );
});

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
    keywordIds: [keywordId],
    includeSources: false
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

test("returns ordered AI sources only for a competitor result", async () => {
  const keywordId = "01900000-0000-7000-8000-000000000010";
  const snapshotId = "01900000-0000-7000-8000-000000000011";
  const service = new OperationResultService({
    keyword: {
      findMany: async () => [{ id: keywordId, textOriginal: "seo аудит" }]
    },
    aiAnswerSnapshot: {
      findMany: async () => [{
        id: snapshotId,
        keywordId,
        answerPresent: true,
        siteFound: false,
        position: null,
        rankingUrl: null,
        brandFound: false,
        observedAt: new Date("2026-09-02T12:00:00.000Z"),
        _count: { sources: 2 }
      }]
    },
    aiAnswerSource: {
      findMany: async () => [
        {
          snapshotId,
          position: 1,
          url: "https://competitor.example/a",
          title: "Первый конкурент",
          description: "Описание первого результата"
        },
        {
          snapshotId,
          position: 2,
          url: "https://competitor.example/b",
          title: null,
          description: null
        }
      ]
    }
  } as unknown as PrismaService);

  const result = await service.aiAnswer({
    workspaceId,
    projectId,
    actorId,
    jobId,
    keywordIds: [keywordId],
    includeSources: true
  });

  assert.deepEqual(result.rows[0]?.snapshot?.sources, [
    {
      position: 1,
      url: "https://competitor.example/a",
      title: "Первый конкурент",
      description: "Описание первого результата"
    },
    { position: 2, url: "https://competitor.example/b" }
  ]);
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
    },
    rankSnapshot: {
      groupBy: async () => [
        { found: true, _count: { _all: 1 } },
        { found: false, _count: { _all: 1 } }
      ]
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
  assert.deepEqual(first.counts, { foundCount: 1, notFoundCount: 1 });
  assert.deepEqual(second.page, { hasNext: false });
  assert.equal(rows[1]?.position, 7);
  assert.equal(rows[1]?.rankingUrl, "https://example.com/found");
  assert.equal(rows[2]?.observedAt, "2026-08-02T10:01:00.000Z");
});

test("preserves competitor purpose and returns its selected-depth organic SERP", async () => {
  const snapshotId = "01900000-0000-7000-8000-000000000030";
  const service = new OperationResultService({
    rankExecutionManifest: {
      findFirst: async () => ({
        id: "01900000-0000-7000-8000-000000000007",
        trackingContextId: "01900000-0000-7000-8000-000000000006",
        execution: {
          ...execution(),
          purpose: "COMPETITOR_SERP",
          saveProjectPosition: false
        },
        context: { name: "Google · Москва · Десктоп" }
      })
    },
    rankExecutionManifestEntry: {
      findMany: async () => [{
        ...rankEntry(0, {
          id: snapshotId,
          found: false,
          position: null,
          absolutePosition: null,
          pixelPosition: null,
          rankingUrl: null,
          title: null,
          snippet: null,
          observedAt: new Date("2026-09-02T10:00:00.000Z"),
          dataQualityFlags: []
        })
      }]
    },
    rankSnapshot: {
      groupBy: async () => [{ found: false, _count: { _all: 1 } }]
    },
    rankSerpResult: {
      findMany: async () => [
        {
          snapshotId,
          position: 1,
          rankingUrl: "https://first.example/page",
          faviconUrl: "https://first.example/favicon.ico",
          title: "Первый результат",
          snippet: "Описание первого результата"
        },
        {
          snapshotId,
          position: 10,
          rankingUrl: "https://tenth.example/page",
          faviconUrl: null,
          title: null,
          snippet: null
        }
      ]
    }
  } as unknown as PrismaService);

  const result = await service.rank(context, jobId, 200);

  assert.equal(result.execution.purpose, "COMPETITOR_SERP");
  assert.equal(result.execution.saveProjectPosition, false);
  assert.deepEqual(result.rows[0]?.serpResults, [
    {
      position: 1,
      rankingUrl: "https://first.example/page",
      faviconUrl: "https://first.example/favicon.ico",
      title: "Первый результат",
      snippet: "Описание первого результата"
    },
    { position: 10, rankingUrl: "https://tenth.example/page" }
  ]);
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
    frequencySnapshot: { findMany: async () => snapshots },
    frequencySeasonalityPoint: { findMany: async () => [] }
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
    keyword: { textOriginal: `Keyword ${sequence + 1}`, version: 7, status: "ACTIVE" },
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
