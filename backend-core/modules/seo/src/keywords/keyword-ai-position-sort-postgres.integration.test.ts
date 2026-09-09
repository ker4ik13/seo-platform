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
const observedAt = "2026-09-04T10:00:00.000Z";
const keywords = Array.from({ length: 11 }, (_, index) => ({
  id: id(index + 1),
  workspace_id: index === 8 ? id(201) : workspaceId,
  project_id: index === 9 ? id(202) : projectId,
  status: index === 10 ? "DELETED" : "ACTIVE"
}));

interface SnapshotFixture {
  id: string;
  workspace_id: string;
  project_id: string;
  keyword_id: string;
  search_engine: "YANDEX" | "GOOGLE";
  observed_at: string;
  answer_present: boolean;
  site_found: boolean;
  position: number | null;
  position_tracking_enabled: boolean;
}

const snapshots: SnapshotFixture[] = [];
for (const searchEngine of ["YANDEX", "GOOGLE"] as const) {
  const positions = searchEngine === "YANDEX" ? [2, 7, 3, 9] : [9, 1, 8, 2];
  for (let index = 0; index < 7; index += 1) {
    if (index === 2 || index === 3 || index === 5) {
      snapshots.push(snapshot(index + 1, searchEngine, {
        position: positions[index] ?? 5,
        site_found: true,
        observed_at: "2026-09-03T10:00:00.000Z"
      }));
    }
    snapshots.push(snapshot(index + 1, searchEngine, {
      answer_present: index < 5,
      site_found: index < 2,
      position: index < 2 ? positions[index]! : null
    }));
  }
  // A newer competitor-only snapshot must not change the positional sort.
  snapshots.push(snapshot(1, searchEngine, {
    answer_present: false,
    position_tracking_enabled: false,
    observed_at: "2026-09-04T11:00:00.000Z"
  }));
  // A different tenant/project cannot supply this keyword's position.
  snapshots.push(snapshot(5, searchEngine, {
    workspace_id: id(201),
    site_found: true,
    position: 1
  }));
  snapshots.push(snapshot(5, searchEngine, {
    project_id: id(202),
    site_found: true,
    position: 1
  }));
}

test(
  "PostgreSQL keeps absent AI answers last for both engines and cursor directions",
  { skip: !databaseUrl, timeout: 15_000 },
  async (t) => {
    const database = new PrismaService(loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl!
    }));
    const service = new KeywordService({
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        // Execute the production query against query-local fixtures only:
        // no writes, temporary tables or reads of tenant data are required.
        return database.$queryRaw(Prisma.sql`
          WITH keywords AS (
            SELECT * FROM jsonb_to_recordset(${JSON.stringify(keywords)}::jsonb)
              AS fixture(id uuid, workspace_id uuid, project_id uuid, status text)
          ), ai_answer_snapshots AS (
            SELECT * FROM jsonb_to_recordset(${JSON.stringify(snapshots)}::jsonb)
              AS fixture(
                id uuid, workspace_id uuid, project_id uuid, keyword_id uuid,
                search_engine text, observed_at timestamptz, answer_present boolean,
                site_found boolean, position integer, position_tracking_enabled boolean
              )
          )
          ${Prisma.sql(strings, ...values)}
        `);
      },
      keyword: {
        count: async () => 8,
        findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
          keywords.filter((row) => where.id.in.includes(row.id)).map(aggregate)
      },
      trackingContextKeywordAssignment: { findMany: async () => [] },
      frequencySnapshot: { findMany: async () => [] },
      currentRank: { findMany: async () => [] },
      aiAnswerSnapshot: { findMany: async () => [] },
      rankDimensionHistoryDeletion: { findMany: async () => [] }
    } as unknown as PrismaService, {} as SemanticVersionService);

    try {
      const cases: readonly [SemanticKeywordSort, readonly number[]][] = [
        ["YANDEX_AI_POSITION_ASC", [1, 2, 3, 4, 5, 6, 7, 8]],
        ["YANDEX_AI_POSITION_DESC", [2, 1, 4, 3, 5, 8, 7, 6]],
        ["GOOGLE_AI_POSITION_ASC", [2, 1, 4, 3, 5, 6, 7, 8]],
        ["GOOGLE_AI_POSITION_DESC", [1, 2, 3, 4, 5, 8, 7, 6]]
      ];
      for (const [sort, expected] of cases) {
        await t.test(sort, async () => {
          for (const limit of [100, 2]) {
            const received: string[] = [];
            let cursor: string | undefined;
            do {
              const page = await service.list(workspaceId, projectId, {
                sort,
                limit,
                ...(cursor ? { cursor } : {})
              }, "request-ai-sort-test");
              received.push(...page.data.map((row) => row.id));
              assert.ok(received.length <= expected.length, "cursor must not repeat rows");
              assert.equal(page.page.hasNext, Boolean(page.page.nextCursor));
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

function id(value: number): string {
  return `01900000-0000-7000-8000-${String(value).padStart(12, "0")}`;
}

function snapshot(
  keyword: number,
  searchEngine: SnapshotFixture["search_engine"],
  overrides: Partial<SnapshotFixture>
): SnapshotFixture {
  return {
    id: id(1_000 + snapshots.length),
    workspace_id: workspaceId,
    project_id: projectId,
    keyword_id: id(keyword),
    search_engine: searchEngine,
    observed_at: observedAt,
    answer_present: true,
    site_found: false,
    position: null,
    position_tracking_enabled: true,
    ...overrides
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
    customValues: {},
    typedCustomValues: [],
    sourceMode: "MANUAL",
    sourceId: null,
    version: 1,
    createdAt: new Date(observedAt),
    updatedAt: new Date(observedAt),
    deletedAt: null,
    memberships: [],
    tags: []
  };
}
