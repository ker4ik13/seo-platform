import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { SemanticImportService } from "./semantic-import.service.js";
import { KeywordRankComparisonService } from "../keywords/keyword-rank-comparison.service.js";
import { KeywordService } from "../keywords/keyword.service.js";
import { SemanticPositionHistoryExportService } from "../semantic-exports/semantic-position-history-export.service.js";
import type { SemanticVersionService } from "../semantic-versions/semantic-version.service.js";

const databaseUrl = process.env.SEO_DATA_MANUAL_HISTORY_TEST_DATABASE_URL;

test("PostgreSQL imports dated manual history idempotently and updates only the newest current rank", { skip: !databaseUrl, timeout: 60_000 }, async () => {
  assert.ok(databaseUrl);
  const url = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port && url.port !== "5432", "Disposable cluster required");
  const prisma = new PrismaService(loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl }));
  const service = new SemanticImportService(prisma);
  try {
    const [ids] = await prisma.$queryRaw<{ workspaceId: string; projectId: string; actorId: string; importId: string }[]>`SELECT uuidv7() AS "workspaceId", uuidv7() AS "projectId", uuidv7() AS "actorId", uuidv7() AS "importId"`;
    assert.ok(ids);
    const normalized = await service.normalizeKeywords({ ...ids, rows: [{ rowNumber: "1", text: "история позиции тест", language: "ru" }] });
    const keyword = normalized.rows[0]!;
    const rows = [{
      sourceRowNumber: "1", textOriginal: keyword.textOriginal, textNormalized: keyword.textNormalized,
      normalizedHash: keyword.normalizedHash, language: keyword.language, customValues: {},
      positionHistory: [
        { searchEngine: "GOOGLE" as const, countryCode: "RU", regionCode: "1011969", regionLabel: "Москва", language: "ru", device: "MOBILE" as const, observedAt: "2026-08-01T12:00:00.000Z", found: true, position: 9 },
        { searchEngine: "GOOGLE" as const, countryCode: "RU", regionCode: "1011969", regionLabel: "Москва", language: "ru", device: "MOBILE" as const, observedAt: "2026-08-08T12:00:00.000Z", found: false },
        { searchEngine: "GOOGLE" as const, countryCode: "RU", regionCode: "1011973", regionLabel: "Санкт-Петербург", language: "ru", device: "DESKTOP" as const, observedAt: "2026-08-08T15:00:00.000Z", found: true, position: 3 }
      ]
    }];
    const entitlement = { planCode: "TEST", planVersion: 1, storedKeywords: 100, keywordsPerProject: 100, foldersPerProject: 100, trackedContextPairs: 100 };
    await service.begin({ ...ids, mappingHash: createHash("sha256").update("mapping").digest("hex"), duplicatePolicy: "MERGE_NON_EMPTY", createMissingKeywords: true, expectedChunks: 1, expectedUniqueRows: "1", expectedNewKeywords: "1", entitlement });
    const input = { ...ids, chunkIndex: 0, payloadHash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"), duplicatePolicy: "MERGE_NON_EMPTY" as const, createMissingKeywords: true, rows };
    const first = await service.applyChunk(input);
    assert.equal(first.createdKeywords, "1");
    assert.equal(first.createdMetricSnapshots, "3");
    assert.deepEqual(await service.applyChunk(input), first, "exact retry must not duplicate snapshots");
    const snapshots = await prisma.rankSnapshot.findMany({ where: { workspaceId: ids.workspaceId, projectId: ids.projectId }, orderBy: { observedAt: "asc" } });
    assert.deepEqual(snapshots.map(row => ({ provider: row.provider, observedAt: row.observedAt.toISOString(), found: row.found, position: row.position, flags: row.dataQualityFlags })), [
      { provider: "MANUAL_IMPORT", observedAt: "2026-08-01T12:00:00.000Z", found: true, position: 9, flags: ["IMPORTED_MANUAL_HISTORY"] },
      { provider: "MANUAL_IMPORT", observedAt: "2026-08-08T12:00:00.000Z", found: false, position: null, flags: ["IMPORTED_MANUAL_HISTORY"] },
      { provider: "MANUAL_IMPORT", observedAt: "2026-08-08T15:00:00.000Z", found: true, position: 3, flags: ["IMPORTED_MANUAL_HISTORY"] }
    ]);
    const configuration = await prisma.trackingContextVersion.findFirstOrThrow({ where: { workspaceId: ids.workspaceId, projectId: ids.projectId, device: "MOBILE" } });
    const current = await prisma.currentRank.findFirstOrThrow({ where: { workspaceId: ids.workspaceId, projectId: ids.projectId, trackingContextId: configuration.contextId } });
    assert.equal(current.observedAt.toISOString(), "2026-08-08T12:00:00.000Z");
    assert.equal(current.previousPosition, 9);
    assert.equal(current.found, false);
    assert.deepEqual({ engine: configuration.searchEngine, region: configuration.regionCode, device: configuration.device }, { engine: "GOOGLE", region: "1011969", device: "MOBILE" });
    const comparison = new KeywordRankComparisonService(prisma);
    const catalog = await comparison.catalog(ids);
    const dimension = catalog.dimensions.find(item => item.searchEngine === "GOOGLE" && item.regionCode === "1011969" && item.device === "MOBILE");
    assert.ok(dimension);
    const compared = await comparison.compare(ids, { keywordIds: [current.keywordId], dimensionKeys: [dimension.key] });
    assert.deepEqual({ found: compared[0]?.found, previous: compared[0]?.previousPosition, provider: compared[0]?.provider }, { found: false, previous: 9, provider: "MANUAL_IMPORT" });
    const keywords = new KeywordService(prisma, {} as SemanticVersionService);
    const daily = await keywords.positionHistory(ids.workspaceId, ids.projectId, { includeUntracked: true });
    assert.deepEqual(daily, {
      points: [
        {
          id: "day:2026-08-01",
          date: "2026-08-01",
          observedAt: "2026-08-01T12:00:00.000Z",
          measuredKeywordCount: 1,
          positionedKeywordCount: 1,
          top1KeywordCount: 0,
          top3KeywordCount: 0,
          top5KeywordCount: 0,
          top10KeywordCount: 1,
          top30KeywordCount: 1,
          top50KeywordCount: 1
        },
        {
          id: "day:2026-08-08",
          date: "2026-08-08",
          observedAt: "2026-08-08T15:00:00.000Z",
          measuredKeywordCount: 1,
          positionedKeywordCount: 1,
          top1KeywordCount: 1,
          top3KeywordCount: 1,
          top5KeywordCount: 1,
          top10KeywordCount: 1,
          top30KeywordCount: 1,
          top50KeywordCount: 1
        }
      ],
      truncated: false
    });
    const mobileDaily = await keywords.positionHistory(
      ids.workspaceId,
      ids.projectId,
      { includeUntracked: true, rankDimensionKey: dimension.key }
    );
    assert.deepEqual(
      mobileDaily.points.map(point => ({
        date: point.date,
        measured: point.measuredKeywordCount,
        positioned: point.positionedKeywordCount,
        top10: point.top10KeywordCount
      })),
      [
        { date: "2026-08-01", measured: 1, positioned: 1, top10: 1 },
        { date: "2026-08-08", measured: 1, positioned: 0, top10: 0 }
      ]
    );
    const filtered = await keywords.list(ids.workspaceId, ids.projectId, { limit: 100, rankDimensionKey: dimension.key, rankState: "NOT_FOUND" }, "manual-history-filter");
    assert.deepEqual(filtered.data.map(item => item.id), [current.keywordId]);
    const exported = await new SemanticPositionHistoryExportService(prisma, keywords).list(ids, { limit: 100 }, { observedFrom: "2026-08-01T00:00:00.000Z", observedBefore: "2026-09-01T00:00:00.000Z", searchEngines: ["GOOGLE"], dimensionKeys: [dimension.key] }, "manual-history-export");
    assert.equal(exported.data.length, 1);
    assert.deepEqual(exported.data[0]?.snapshots.map(item => ({ date: item.observedDate, found: item.found, position: item.position })), [
      { date: "2026-08-08", found: false, position: undefined },
      { date: "2026-08-01", found: true, position: 9 }
    ]);
  } finally { await prisma.$disconnect(); }
});
