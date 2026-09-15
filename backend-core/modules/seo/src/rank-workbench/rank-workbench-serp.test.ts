import assert from "node:assert/strict";
import test from "node:test";
import { semanticRankDimensionKey } from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import { RankWorkbenchService } from "./rank-workbench.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const groupId = "01900000-0000-7000-8000-000000000003";
const keywordId = "01900000-0000-7000-8000-000000000004";
const snapshotId = "01900000-0000-7000-8000-000000000005";
const dimension = {
  searchEngine: "YANDEX" as const,
  countryCode: "RU",
  regionCode: "213",
  language: "ru",
  device: "DESKTOP" as const
};

test("projects imported Key Collector SERP through the canonical workbench contract", async () => {
  let snapshotQuery = "";
  const prisma = {
    rankDimensionMerge: { findMany: async () => [] },
    $queryRaw: async (query: Prisma.Sql) => {
      const sql = query.strings.join(" ");
      if (sql.includes("count(*) OVER")) {
        return [{
          id: keywordId,
          version: 7,
          query: "сертификат на гирлянду",
          language: "ru",
          groupPath: "Сертификация / Гирлянды",
          targetUrl: null,
          totalCount: 1n
        }];
      }
      if (sql.includes("SELECT DISTINCT ON (snapshot.keyword_id)")) {
        snapshotQuery = sql;
        return [{
          keywordId,
          snapshotId,
          observedAt: new Date("2024-04-18T00:00:00.000Z"),
          provider: "KEY_COLLECTOR"
        }];
      }
      throw new Error(`Unexpected workbench query: ${sql.slice(0, 80)}`);
    },
    aiAnswerSnapshot: { findMany: async () => [] },
    rankSerpResult: {
      findMany: async () => [{
        snapshotId,
        position: 1,
        rankingUrl: "https://example.ru/catalog",
        faviconUrl: null,
        title: "Каталог",
        snippet: "Описание"
      }]
    },
    keywordTag: { findMany: async () => [] }
  } as unknown as PrismaService;
  const service = new RankWorkbenchService(prisma);
  const dimensionKey = semanticRankDimensionKey(dimension);

  const report = await service.serp(
    { workspaceId, projectId },
    { dimensionKeys: [dimensionKey], groupIds: [groupId], limit: 50 }
  );

  assert.match(snapshotQuery, /'KEY_COLLECTOR'/u);
  assert.equal(report.rows[0]?.snapshots[0]?.provider, "KEY_COLLECTOR");
  assert.equal(report.rows[0]?.snapshots[0]?.dimensionKey, dimensionKey);
  assert.equal(
    report.rows[0]?.snapshots[0]?.results[0]?.url,
    "https://example.ru/catalog"
  );
});
