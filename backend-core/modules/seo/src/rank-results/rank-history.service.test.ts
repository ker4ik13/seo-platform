import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import type {
  InternalRankHistoryQuery
} from "@seo-platform/contracts";
import type { PrismaService } from "../database/prisma.service.js";
import type { AppConfig } from "../config/app-config.js";
import { RankHistoryService } from "./rank-history.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const keywordId = "01900000-0000-7000-8000-000000000004";
const trackingContextId =
  "01900000-0000-7000-8000-000000000005";
const jobId = "01900000-0000-7000-8000-000000000006";
const firstSnapshotId =
  "01900000-0000-7000-8000-000000000008";
const secondSnapshotId =
  "01900000-0000-7000-8000-000000000007";

test("returns tenant-scoped history and authenticates its keyset cursor", async () => {
  const harness = historyHarness();
  const service = new RankHistoryService(
    harness.prisma,
    config()
  );
  const first = await service.list(query());

  assert.equal(first.workspaceId, workspaceId);
  assert.equal(first.projectId, projectId);
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0]?.snapshotId, firstSnapshotId);
  assert.equal(first.items[0]?.position, 100);
  assert.equal(first.items[0]?.contextName, "Москва · десктоп");
  assert.equal(first.items[0]?.searchEngine, "YANDEX");
  assert.equal(first.items[0]?.dimensionKey, "YANDEX|RU|213|ru|DESKTOP");
  assert.equal(first.items[0]?.searchSource, "LIVE");
  assert.deepEqual(first.items[0]?.siteResults, [
    {
      position: 4,
      rankingUrl: "https://example.com/other",
      title: "Project page"
    },
    { position: 100, rankingUrl: "https://example.com/rank" }
  ]);
  assert.equal(first.page.hasNext, true);
  assert.ok(first.page.nextCursor);
  assert.equal(harness.calls, 1);
  assert.equal(harness.wheres[0]?.workspaceId, workspaceId);
  assert.equal(harness.wheres[0]?.projectId, projectId);
  assert.deepEqual(harness.wheres[0]?.sourceMode, { in: ["BYOK", "PLATFORM", "IMPORT"] });
  assert.deepEqual(harness.wheres[0]?.provider, { in: ["ARSENKIN", "XMLSTOCK", "KEY_COLLECTOR", "MANUAL_IMPORT"] });

  const second = await service.list({
    ...query(),
    cursor: first.page.nextCursor
  });
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0]?.snapshotId, secondSnapshotId);
  assert.equal(second.page.hasNext, false);
  assert.equal(harness.calls, 2);
  assert.ok("OR" in (harness.wheres[1] ?? {}));
});

test("rejects cross-tenant, filter-drift and tampered cursors before a query", async () => {
  const harness = historyHarness();
  const service = new RankHistoryService(
    harness.prisma,
    config()
  );
  const first = await service.list(query());
  const cursor = first.page.nextCursor!;

  for (const changed of [
    {
      ...query(),
      workspaceId:
        "01900000-0000-7000-8000-000000000099",
      cursor
    },
    {
      ...query(),
      keywordId:
        "01900000-0000-7000-8000-000000000098",
      cursor
    },
    {
      ...query(),
      cursor: `${cursor.slice(0, -1)}${
        cursor.endsWith("a") ? "b" : "a"
      }`
    }
  ]) {
    await assert.rejects(
      () => service.list(changed),
      BadRequestException
    );
  }
  assert.equal(harness.calls, 1);
});

test("returns an imported manual position without inventing a result URL", async () => {
  const row = {
    ...foundRow(),
    id: "2c64b96f-0747-5cc4-8477-43bade090d31",
    trackingContextId: "c53bcb2b-c890-5ed0-97cb-c8ba4bb975e3",
    jobId: "4223aa99-a200-5efa-a377-0dca071ebd5c",
    provider: "MANUAL_IMPORT",
    sourceMode: "IMPORT",
    rankingUrl: null,
    normalizedRankingUrl: null,
    resultType: "ORGANIC",
    dataQualityFlags: ["IMPORTED_MANUAL_HISTORY"],
    serpResults: [],
    manifest: {
      ...foundRow().manifest,
      execution: { source: "MANUAL_HISTORY", searchEngine: "YANDEX" },
      context: { name: "Ручной импорт · Москва · ПК" }
    }
  };
  const service = new RankHistoryService({
    rankDimensionHistoryDeletion: { findMany: async () => [] },
    rankSnapshot: { findMany: async () => [row] }
  } as unknown as PrismaService, config());

  const result = await service.list({ ...query(), limit: 10 });

  assert.deepEqual(
    {
      provider: result.items[0]?.provider,
      found: result.items[0]?.found,
      position: result.items[0]?.position,
      hasUrl: "rankingUrl" in (result.items[0] ?? {})
    },
    { provider: "MANUAL_IMPORT", found: true, position: 100, hasUrl: false }
  );
});

test("returns imported Key Collector SERP history", async () => {
  const row = {
    ...foundRow(),
    id: "2c64b96f-0747-5cc4-8477-43bade090d31",
    trackingContextId: "c53bcb2b-c890-5ed0-97cb-c8ba4bb975e3",
    jobId: "4223aa99-a200-5efa-a377-0dca071ebd5c",
    provider: "KEY_COLLECTOR",
    sourceMode: "IMPORT",
    dataQualityFlags: ["IMPORTED_KC4"],
    connectorVersion: "key-collector@import",
    manifest: {
      ...foundRow().manifest,
      execution: { source: "KC4", searchEngine: "YANDEX" },
      context: { name: "Импорт Key Collector · Яндекс · Москва · ПК" }
    }
  };
  const service = new RankHistoryService({
    rankDimensionHistoryDeletion: { findMany: async () => [] },
    rankSnapshot: { findMany: async () => [row] }
  } as unknown as PrismaService, config());

  const result = await service.list({ ...query(), mode: "SERP", limit: 10 });

  assert.equal(result.items[0]?.provider, "KEY_COLLECTOR");
  assert.equal(result.items[0]?.serpResults?.length, 3);
  assert.equal(result.items[0]?.serpResults?.[0]?.rankingUrl, "https://competitor.test/");
});

function query(): InternalRankHistoryQuery {
  return {
    workspaceId,
    projectId,
    actorId,
    observedFrom: "2026-07-01T00:00:00.000Z",
    observedBefore: "2026-08-01T00:00:00.000Z",
    trackingContextId,
    limit: 1
  };
}

function config(): AppConfig {
  return {
    nodeEnv: "test",
    bindAddress: "127.0.0.1",
    port: 4001,
    version: "test",
    databaseUrl: "postgresql://test",
    databasePoolMax: 1,
    rankHistoryCursorKey: "c".repeat(32),
    nats: { url: "nats://test" }
  };
}

function historyHarness() {
  let calls = 0;
  const wheres: Array<Readonly<Record<string, unknown>>> = [];
  const prisma = {
    rankDimensionHistoryDeletion: { findMany: async () => [] },
    rankSnapshot: {
      findMany: async ({
        where
      }: {
        where: Readonly<Record<string, unknown>>;
      }) => {
        wheres.push(where);
        calls += 1;
        return calls === 1
          ? [foundRow(), notFoundRow()]
          : [notFoundRow()];
      }
    }
  } as unknown as PrismaService;
  return {
    prisma,
    wheres,
    get calls() {
      return calls;
    }
  };
}

function foundRow() {
  return {
    id: firstSnapshotId,
    workspaceId,
    projectId,
    keywordId,
    trackingContextId,
    configurationVersion: 2,
    jobId,
    observedAt: new Date("2026-07-29T12:00:00.000Z"),
    found: true,
    position: 100,
    absolutePosition: null,
    pixelPosition: null,
    rankingUrl: "https://example.com/rank",
    normalizedRankingUrl: "https://example.com/rank",
    title: null,
    snippet: null,
    resultType: "ORGANIC",
    serpFeatures: [],
    dataQualityFlags: [
      "ABSOLUTE_POSITION_UNAVAILABLE",
      "PIXEL_POSITION_UNAVAILABLE",
      "TITLE_UNAVAILABLE",
      "SNIPPET_UNAVAILABLE"
    ],
    provider: "ARSENKIN",
    sourceMode: "BYOK",
    connectorVersion: "1.0.0",
    createdAt: new Date("2026-07-29T12:00:01.000Z"),
    manifest: {
      projectDomain: "example.com",
      execution: {
        providerMappingVersion: "arsenkin-yandex-live@4"
      },
      context: { name: "Москва · десктоп" },
      configuration: {
        searchEngine: "YANDEX",
        countryCode: "RU",
        regionCode: "213",
        regionLabel: "Москва",
        language: "ru",
        device: "DESKTOP",
        depth: 100
      }
    },
    serpResults: [
      {
        position: 1,
        rankingUrl: "https://competitor.test/",
        normalizedRankingUrl: "https://competitor.test/",
        title: "Competitor",
        snippet: "Stored result"
      },
      {
        position: 4,
        rankingUrl: "https://example.com/other",
        normalizedRankingUrl: "https://example.com/other",
        title: "Project page",
        snippet: null
      },
      {
        position: 100,
        rankingUrl: "https://example.com/rank",
        normalizedRankingUrl: "https://example.com/rank",
        title: null,
        snippet: null
      }
    ]
  };
}

function notFoundRow() {
  return {
    id: secondSnapshotId,
    workspaceId,
    projectId,
    keywordId,
    trackingContextId,
    configurationVersion: 2,
    jobId,
    observedAt: new Date("2026-07-29T11:00:00.000Z"),
    found: false,
    position: null,
    absolutePosition: null,
    pixelPosition: null,
    rankingUrl: null,
    normalizedRankingUrl: null,
    title: null,
    snippet: null,
    resultType: null,
    serpFeatures: [],
    dataQualityFlags: [],
    provider: "ARSENKIN",
    sourceMode: "BYOK",
    connectorVersion: "1.0.0",
    createdAt: new Date("2026-07-29T11:00:01.000Z"),
    manifest: {
      projectDomain: "example.com",
      execution: {
        providerMappingVersion: "arsenkin-yandex-live@4"
      },
      context: { name: "Москва · десктоп" },
      configuration: {
        searchEngine: "YANDEX",
        countryCode: "RU",
        regionCode: "213",
        regionLabel: "Москва",
        language: "ru",
        device: "DESKTOP",
        depth: 100
      }
    },
    serpResults: []
  };
}
