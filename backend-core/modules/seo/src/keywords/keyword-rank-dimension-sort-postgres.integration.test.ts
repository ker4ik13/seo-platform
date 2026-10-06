import assert from "node:assert/strict";
import test from "node:test";
import type { SemanticKeywordSort } from "@seo-platform/contracts";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { Prisma } from "../generated/prisma/client.js";
import type { SemanticVersionService } from "../semantic-versions/semantic-version.service.js";
import { KeywordService } from "./keyword.service.js";

const databaseUrl = process.env.SEO_DATA_KEYWORD_SORT_TEST_DATABASE_URL;
const workspaceId = id(101);
const projectId = id(102);
const targetDimension = "GOOGLE|RU|1011973|ru|MOBILE";
const targetContext = id(201);
const otherContext = id(202);
const keywords = Array.from({ length: 8 }, (_, index) => ({
  id: id(index + 1),
  workspace_id: workspaceId,
  project_id: projectId,
  status: "ACTIVE"
}));
const configurations = [
  {
    workspace_id: workspaceId,
    project_id: projectId,
    context_id: targetContext,
    configuration_version: 1,
    search_engine: "GOOGLE",
    country_code: "RU",
    region_code: "1011973",
    language: "ru",
    device: "MOBILE"
  },
  {
    workspace_id: workspaceId,
    project_id: projectId,
    context_id: targetContext,
    configuration_version: 2,
    search_engine: "YANDEX",
    country_code: "RU",
    region_code: "2",
    language: "ru",
    device: "DESKTOP"
  },
  {
    workspace_id: workspaceId,
    project_id: projectId,
    context_id: otherContext,
    configuration_version: 1,
    search_engine: "GOOGLE",
    country_code: "RU",
    region_code: "1011969",
    language: "ru",
    device: "DESKTOP"
  }
];
const currentRanks = [
  current(1, targetContext, true, 2, "2026-09-04T10:00:00.000Z"),
  current(1, targetContext, true, 41, "2026-09-08T10:00:00.000Z", 2),
  current(2, targetContext, true, 7, "2026-09-02T10:00:00.000Z"),
  current(3, targetContext, false, null, "2026-09-05T10:00:00.000Z"),
  current(4, targetContext, false, null, "2026-09-01T10:00:00.000Z"),
  current(5, targetContext, false, null, "2026-09-03T10:00:00.000Z"),
  current(7, otherContext, true, 1, "2026-09-06T10:00:00.000Z"),
  current(8, targetContext, false, null, "2026-09-07T10:00:00.000Z")
];
const snapshots = [
  ...currentRanks.map(snapshotFromCurrent),
  previous(3, 1, true, 3, "2026-09-03T10:00:00.000Z"),
  previous(4, 1, true, 9, "2026-08-30T10:00:00.000Z"),
  previous(5, 1, true, 11, "2026-08-30T10:00:00.000Z"),
  previous(5, 2, false, null, "2026-09-02T10:00:00.000Z")
];

test(
  "PostgreSQL sorts position and capture time inside one exact rank dimension",
  { skip: !databaseUrl, timeout: 20_000 },
  async (t) => {
    const database = new PrismaService(loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl!
    }));
    const queryRaw = (strings: TemplateStringsArray, ...values: unknown[]) =>
        database.$queryRaw(Prisma.sql`
          WITH keywords AS (
            SELECT * FROM jsonb_to_recordset(${JSON.stringify(keywords)}::jsonb)
              AS fixture(id uuid, workspace_id uuid, project_id uuid, status text)
          ), tracking_context_versions AS (
            SELECT * FROM jsonb_to_recordset(${JSON.stringify(configurations)}::jsonb)
              AS fixture(
                workspace_id uuid, project_id uuid, context_id uuid,
                configuration_version integer, search_engine text,
                country_code text, region_code text, language text, device text
              )
          ), current_ranks AS (
            SELECT * FROM jsonb_to_recordset(${JSON.stringify(currentRanks)}::jsonb)
              AS fixture(
                workspace_id uuid, project_id uuid, keyword_id uuid,
                tracking_context_id uuid, configuration_version integer,
                found boolean, position integer, previous_position integer,
                observed_at timestamptz, snapshot_id uuid
              )
          ), rank_snapshots AS (
            SELECT * FROM jsonb_to_recordset(${JSON.stringify(snapshots)}::jsonb)
              AS fixture(
                id uuid, workspace_id uuid, project_id uuid, keyword_id uuid,
                tracking_context_id uuid, configuration_version integer,
                found boolean, position integer, position_tracking_enabled boolean,
                observed_at timestamptz
              )
          )
          ${Prisma.sql(strings, ...values)}
        `);
    const service = new KeywordService({
      $queryRaw: queryRaw,
      $transaction: async (work: (transaction: unknown) => Promise<unknown>) =>
        work({ $executeRaw: async () => 0, $queryRaw: queryRaw }),
      keyword: {
        count: async () => keywords.length,
        findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
          keywords.filter(row => where.id.in.includes(row.id)).map(aggregate)
      },
      trackingContextKeywordAssignment: { findMany: async () => [] },
      frequencySnapshot: { findMany: async () => [] },
      currentRank: { findMany: async () => [] },
      aiAnswerSnapshot: { findMany: async () => [] },
      rankDimensionHistoryDeletion: { findMany: async () => [] }
    } as unknown as PrismaService, {} as SemanticVersionService);

    try {
      const cases: readonly [SemanticKeywordSort, readonly number[], boolean][] = [
        ["RANK_POSITION_ASC", [1, 2, 3, 4, 5, 8, 6, 7], true],
        ["RANK_POSITION_DESC", [2, 1, 4, 3, 8, 5, 7, 6], true],
        ["RANK_CHECKED_AT_ASC", [4, 2, 5, 1, 3, 8, 6, 7], true],
        ["RANK_CHECKED_AT_DESC", [8, 3, 1, 5, 2, 4, 7, 6], true],
        ["GOOGLE_POSITION_ASC", [7, 1, 2, 3, 4, 5, 8, 6], false],
        ["GOOGLE_POSITION_DESC", [2, 1, 7, 4, 3, 8, 5, 6], false]
      ];
      for (const [sort, expected, exactDimension] of cases) {
        await t.test(sort, async () => {
          for (const limit of [100, 2]) {
            const received: string[] = [];
            let cursor: string | undefined;
            do {
              const page = await service.list(workspaceId, projectId, {
                limit,
                sort,
                ...(exactDimension ? { rankSortDimensionKey: targetDimension } : {}),
                ...(cursor ? { cursor } : {})
              }, "request-rank-dimension-sort");
              received.push(...page.data.map(row => row.id));
              cursor = page.page.nextCursor;
            } while (cursor);
            assert.deepEqual(received, expected.map(id));
          }
        });
      }
    } finally {
      await database.$disconnect();
    }
  }
);

function current(
  keyword: number,
  context: string,
  found: boolean,
  position: number | null,
  observedAt: string,
  configurationVersion = 1
) {
  return {
    workspace_id: workspaceId,
    project_id: projectId,
    keyword_id: id(keyword),
    tracking_context_id: context,
    configuration_version: configurationVersion,
    found,
    position,
    previous_position: null,
    observed_at: observedAt,
    snapshot_id: id(1_000 + keyword * 10 + configurationVersion)
  };
}

function snapshotFromCurrent(row: (typeof currentRanks)[number]) {
  return {
    id: row.snapshot_id,
    workspace_id: row.workspace_id,
    project_id: row.project_id,
    keyword_id: row.keyword_id,
    tracking_context_id: row.tracking_context_id,
    configuration_version: row.configuration_version,
    found: row.found,
    position: row.position,
    position_tracking_enabled: true,
    observed_at: row.observed_at
  };
}

function previous(
  keyword: number,
  sequence: number,
  found: boolean,
  position: number | null,
  observedAt: string
) {
  return {
    id: id(2_000 + keyword * 10 + sequence),
    workspace_id: workspaceId,
    project_id: projectId,
    keyword_id: id(keyword),
    tracking_context_id: targetContext,
    configuration_version: 1,
    found,
    position,
    position_tracking_enabled: true,
    observed_at: observedAt
  };
}

function aggregate(row: (typeof keywords)[number]) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    textOriginal: `Запрос ${row.id}`,
    textNormalized: `запрос ${row.id}`,
    language: "ru",
    priority: 0,
    isFavorite: false,
    intent: null,
    status: row.status,
    clusterId: null,
    targetPageId: null,
    isTracked: true,
    showAiAnswerButton: true,
    customValues: {},
    typedCustomValues: [],
    sourceMode: "MANUAL",
    sourceId: null,
    version: 1,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    deletedAt: null,
    memberships: [],
    tags: [],
    note: null
  };
}

function id(value: number): string {
  return `01900000-0000-7000-8000-${String(value).padStart(12, "0")}`;
}
