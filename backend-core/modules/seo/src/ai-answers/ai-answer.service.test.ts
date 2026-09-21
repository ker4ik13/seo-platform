import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { InternalAiAnswerHistoryQuery } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import type { PrismaService } from "../database/prisma.service.js";
import { AiAnswerService } from "./ai-answer.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const keywordId = "01900000-0000-7000-8000-000000000004";
const firstSnapshotId = "01900000-0000-7000-8000-000000000006";
const secondSnapshotId = "01900000-0000-7000-8000-000000000005";

test("returns dimension-specific AI position history with an authenticated cursor", async () => {
  const harness = historyHarness();
  const service = new AiAnswerService(harness.prisma, config());
  const first = await service.history(query());

  assert.equal(first.items.length, 1);
  assert.deepEqual(first.items[0], {
    snapshotId: firstSnapshotId,
    keywordId,
    searchEngine: "YANDEX",
    regionCode: "213",
    device: "DESKTOP",
    answerPresent: true,
    siteFound: true,
    position: 3,
    previousPosition: 7,
    rankingUrl: "https://example.com/current",
    brandFound: true,
    provider: "ARSENKIN",
    results: [],
    observedAt: "2026-08-19T12:00:00.000Z"
  });
  assert.equal(first.page.hasNext, true);
  assert.ok(first.page.nextCursor);

  const second = await service.history({
    ...query(),
    cursor: first.page.nextCursor
  });
  assert.equal(second.items[0]?.snapshotId, secondSnapshotId);
  assert.equal(second.items[0]?.siteFound, false);
  assert.equal(second.items[0]?.previousPosition, 11);
  assert.equal(second.page.hasNext, false);
  assert.equal(harness.findManyCalls, 2);
});

test("rejects a tampered or keyword-drifted AI history cursor before reading snapshots", async () => {
  const harness = historyHarness();
  const service = new AiAnswerService(harness.prisma, config());
  const first = await service.history(query());
  const cursor = first.page.nextCursor!;

  await assert.rejects(
    () => service.history({
      ...query(),
      keywordId: "01900000-0000-7000-8000-000000000099",
      cursor
    }),
    BadRequestException
  );
  await assert.rejects(
    () => service.history({
      ...query(),
      cursor: `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}`
    }),
    BadRequestException
  );
  assert.equal(harness.findManyCalls, 1);
});

function query(): InternalAiAnswerHistoryQuery {
  return {
    workspaceId,
    projectId,
    actorId,
    keywordId,
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
    rankHistoryCursorKey: "h".repeat(32),
    nats: { url: "nats://test" }
  };
}

function historyHarness() {
  let findManyCalls = 0;
  let previousCalls = 0;
  const prisma = {
    keyword: { findFirst: async () => ({ id: keywordId }) },
    aiAnswerSnapshot: {
      findMany: async () => {
        findManyCalls += 1;
        return findManyCalls === 1
          ? [foundRow(), missingRow()]
          : [missingRow()];
      }
    },
    $queryRaw: async () => {
      previousCalls += 1;
      const row = previousCalls === 1 ? foundRow() : missingRow();
      return [{
        keywordId,
        searchEngine: "YANDEX",
        regionCode: row.regionCode,
        device: row.device,
        observedAt: row.observedAt,
        snapshotId: row.id,
        previousPosition: previousCalls === 1 ? 7 : 11
      }];
    }
  } as unknown as PrismaService;
  return {
    prisma,
    get findManyCalls() {
      return findManyCalls;
    }
  };
}

function foundRow() {
  return {
    id: firstSnapshotId,
    keywordId,
    searchEngine: "YANDEX",
    regionCode: "213",
    device: "DESKTOP",
    answerPresent: true,
    siteFound: true,
    position: 3,
    rankingUrl: "https://example.com/current",
    brandFound: true,
    provider: "ARSENKIN",
    sourceMode: "BYOK",
    sources: [],
    observedAt: new Date("2026-08-19T12:00:00.000Z")
  };
}

function missingRow() {
  return {
    id: secondSnapshotId,
    keywordId,
    searchEngine: "YANDEX",
    regionCode: "225",
    device: "MOBILE",
    answerPresent: true,
    siteFound: false,
    position: null,
    rankingUrl: null,
    brandFound: false,
    provider: "ARSENKIN",
    sourceMode: "BYOK",
    sources: [],
    observedAt: new Date("2026-08-18T12:00:00.000Z")
  };
}

test("competitor history includes untracked Google SPB snapshots and binds its cursor to the read mode", async () => {
  const queries: Readonly<Record<string, unknown>>[] = [];
  const row = { ...foundRow(), searchEngine: "GOOGLE", regionCode: "1012040", positionTrackingEnabled: false };
  const service = new AiAnswerService({
    keyword: { findFirst: async () => ({ id: keywordId }) },
    aiAnswerSnapshot: { findMany: async ({ where }: { where: Readonly<Record<string, unknown>> }) => {
      queries.push(where);
      return where.positionTrackingEnabled === true ? [] : [row, { ...row, id: secondSnapshotId }];
    } },
    $queryRaw: async () => []
  } as unknown as PrismaService, config());
  assert.equal((await service.history(query())).items.length, 0);
  const result = await service.history({ ...query(), includeCompetitors: true });
  assert.equal(result.items[0]?.regionCode, "1012040");
  assert.ok(result.page.nextCursor);
  assert.equal(queries[1]?.workspaceId, workspaceId);
  assert.equal(queries[1]?.projectId, projectId);
  assert.equal(queries[1]?.positionTrackingEnabled, undefined);
  await assert.rejects(() => service.history({ ...query(), cursor: result.page.nextCursor! }), BadRequestException);
  assert.equal(queries.length, 2);
  await service.history({ ...query(), includeCompetitors: true, cursor: result.page.nextCursor! });
  assert.equal(queries.length, 3);
  const latest = await service.latest(workspaceId, projectId, keywordId);
  assert.equal(latest[0]?.searchEngine, "GOOGLE");
  assert.equal(queries[3]?.positionTrackingEnabled, undefined);
});
