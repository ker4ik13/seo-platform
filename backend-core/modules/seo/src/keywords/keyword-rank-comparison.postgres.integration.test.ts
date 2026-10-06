import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { loadAppConfig } from "../config/app-config.js";
import { KeywordRankComparisonService } from "./keyword-rank-comparison.service.js";

const databaseUrl = process.env.SEO_DATA_KEYWORD_SORT_TEST_DATABASE_URL;
const workspaceId = id(100);
const projectId = id(101);
const firstContext = id(200);
const secondContext = id(201);
const jobId = id(300);
const manifestId = id(301);
const dimensionKey = "YANDEX|RU|213|ru|DESKTOP";
const at = (day: number) => `2026-10-0${day}T10:00:00.000Z`;

test("PostgreSQL batch rank comparison preserves latest and previous positions across contexts and merged keywords", {
  skip: !databaseUrl,
  timeout: 20_000
}, async () => {
  const database = new PrismaService(loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl! }));
  const configurations = [firstContext, secondContext].map((contextId) => ({
    workspace_id: workspaceId, project_id: projectId, context_id: contextId,
    configuration_version: 1, depth: 30, search_engine: "YANDEX",
    country_code: "RU", region_code: "213", language: "ru", device: "DESKTOP"
  }));
  const largeKeywords = Array.from({ length: 1_000 }, (_, index) => index + 10);
  const snapshots = [
    snapshot(1, 1, firstContext, true, 7, 1),
    snapshot(1, 2, secondContext, true, 5, 2),
    snapshot(1, 3, firstContext, true, 3, 3),
    snapshot(2, 4, firstContext, true, 8, 2),
    snapshot(2, 5, secondContext, false, null, 3),
    snapshot(4, 6, secondContext, true, 9, 3),
    ...largeKeywords.flatMap((keyword) => [
      snapshot(keyword, 10_000 + keyword * 2, firstContext, true, 12, 2),
      snapshot(keyword, 10_001 + keyword * 2, secondContext, true, 8, 3)
    ])
  ];
  const fixture = Prisma.sql`
    WITH tracking_context_versions AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(configurations)}::jsonb)
        AS row(workspace_id uuid, project_id uuid, context_id uuid,
          configuration_version integer, depth integer, search_engine text,
          country_code text, region_code text, language text, device text)
    ), keyword_merges AS (
      SELECT ${workspaceId}::uuid AS workspace_id, ${projectId}::uuid AS project_id,
        ${id(3)}::uuid AS target_keyword_id, ${id(4)}::uuid AS source_keyword_id
    ), rank_dimension_history_deletions AS (
      SELECT * FROM jsonb_to_recordset('[]'::jsonb)
        AS row(workspace_id uuid, project_id uuid, search_engine text,
          country_code text, region_code text, language text, device text,
          excluded_through timestamptz)
    ), rank_snapshots AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(snapshots)}::jsonb)
        AS row(id uuid, workspace_id uuid, project_id uuid, keyword_id uuid,
          tracking_context_id uuid, configuration_version integer, job_id uuid,
          manifest_id uuid, observed_at timestamptz, found boolean,
          position integer, ranking_url text, provider text,
          position_tracking_enabled boolean)
    )
  `;
  const prisma = {
    rankDimensionMerge: { findMany: async () => [] },
    $queryRaw: async (query: Prisma.Sql) => {
      const strings = [...query.strings];
      strings[0] = strings[0]!.replace(/^\s*WITH\s+/u, ", ");
      return database.$queryRaw(Prisma.sql`${fixture} ${Prisma.sql(strings, ...query.values)}`);
    }
  } as unknown as PrismaService;
  try {
    const result = await new KeywordRankComparisonService(prisma).compareTrusted(
      { workspaceId, projectId },
      {
        keywordIds: [id(1), id(2), id(3)],
        dimensionKeys: [dimensionKey],
        columnKeys: [`rank:${dimensionKey}:position`],
        includeSiteResultCount: false
      }
    );
    assert.deepEqual(result.map(({ keywordId, found, position, previousPosition }) => ({
      keywordId, found, position: position ?? null, previousPosition: previousPosition ?? null
    })), [
      { keywordId: id(1), found: true, position: 3, previousPosition: 5 },
      { keywordId: id(2), found: false, position: null, previousPosition: 8 },
      { keywordId: id(3), found: true, position: 9, previousPosition: null }
    ]);
    const largePage = await new KeywordRankComparisonService(prisma).compareTrusted(
      { workspaceId, projectId },
      {
        keywordIds: [id(1), id(2), id(3), ...largeKeywords.map(id)],
        dimensionKeys: [dimensionKey],
        columnKeys: [`rank:${dimensionKey}:position`],
        includeSiteResultCount: false
      }
    );
    assert.equal(largePage.length, 1_003);
    assert.deepEqual(largePage.at(-1) && {
      keywordId: largePage.at(-1)!.keywordId,
      position: largePage.at(-1)!.position,
      previousPosition: largePage.at(-1)!.previousPosition
    }, { keywordId: id(1_009), position: 8, previousPosition: 12 });
  } finally {
    await database.$disconnect();
  }
});

function snapshot(keyword: number, sequence: number, context: string, found: boolean,
  position: number | null, day: number) {
  return {
    id: id(400 + sequence), workspace_id: workspaceId, project_id: projectId,
    keyword_id: id(keyword), tracking_context_id: context, configuration_version: 1,
    job_id: jobId, manifest_id: manifestId, observed_at: at(day), found, position,
    ranking_url: null, provider: "XMLSTOCK", position_tracking_enabled: true
  };
}

function id(value: number): string {
  return `01900000-0000-7000-8000-${String(value).padStart(12, "0")}`;
}
