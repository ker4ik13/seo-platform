import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaService } from "../database/prisma.service.js";
import {
  RankWorkbenchService,
  rankWorkbenchReportDates
} from "./rank-workbench.service.js";

test("returns only observed days for a short ranking range", () => {
  assert.deepEqual(
    rankWorkbenchReportDates(
      31,
      [
        new Date("2026-09-01T12:00:00.000Z"),
        new Date("2026-09-04T12:00:00.000Z")
      ]
    ),
    ["2026-09-04", "2026-09-01"]
  );
});

test("returns no columns when the selected range has no position snapshots", () => {
  assert.deepEqual(
    rankWorkbenchReportDates(
      31,
      []
    ),
    []
  );
});

test("samples observed days across a long ranking range", () => {
  const observed = Array.from({ length: 53 }, (_, index) =>
    new Date(Date.UTC(2025, 8, 1 + index * 7))
  );
  const dates = rankWorkbenchReportDates(
    31,
    observed
  );

  assert.equal(dates.length, 31);
  assert.equal(dates[0], "2026-08-31");
  assert.equal(dates.at(-1), "2025-09-01");
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.equal(new Set(dates).size, dates.length);
});

test("uses observed days directly when a long range has no more than the limit", () => {
  const dates = rankWorkbenchReportDates(
    31,
    [new Date("2025-10-10T12:00:00.000Z"), new Date("2026-08-08T12:00:00.000Z")]
  );

  assert.deepEqual(dates, ["2026-08-08", "2025-10-10"]);
});

test("unit SQL generation: AI mode reads immutable AI snapshots, never SEO snapshots", async () => {
  const queries: unknown[] = [];
  const generated = new Error("SQL generation captured; no database is simulated");
  const service = new RankWorkbenchService({
    $queryRaw: async (query: unknown) => {
      queries.push(query);
      throw generated;
    },
    rankDimensionMerge: { findMany: async () => [] }
  } as unknown as PrismaService);

  await assert.rejects(service.positions(
    {
      workspaceId: "01900000-0000-7000-8000-000000000001",
      projectId: "01900000-0000-7000-8000-000000000002"
    },
    {
      mode: "AI",
      dimensionKey: "YANDEX|RU|213|ru|DESKTOP",
      observedFrom: "2026-08-01T00:00:00.000Z",
      observedBefore: "2026-09-11T00:00:00.000Z",
      dateLimit: 31,
      limit: 100,
      sort: "QUERY_ASC"
    }
  ), error => error === generated);

  assert.equal(queries.length, 2);
  for (const query of queries) {
    const text = sqlText(query);
    assert.match(text, /FROM ai_answer_snapshots snapshot/u);
    assert.doesNotMatch(text, /FROM rank_snapshots snapshot/u);
  }
});

function sqlText(value: unknown): string {
  const strings = (value as { readonly strings?: readonly string[] }).strings;
  assert.ok(strings);
  return strings.join(" ");
}

test("unit SQL generation: position order uses the latest project slice, not an older best position", async () => {
  const queries: unknown[] = [];
  const generated = new Error("SQL generation captured; no database is simulated");
  const service = new RankWorkbenchService({
    $queryRaw: async (query: unknown) => { queries.push(query); throw generated; },
    rankDimensionMerge: { findMany: async () => [] }
  } as unknown as PrismaService);
  await assert.rejects(service.positions({ workspaceId: "01900000-0000-7000-8000-000000000001", projectId: "01900000-0000-7000-8000-000000000002" }, {
    mode: "SEO", dimensionKey: "YANDEX|RU|213|ru|DESKTOP", observedFrom: "2026-08-01T00:00:00.000Z", observedBefore: "2026-09-11T00:00:00.000Z", dateLimit: 31, limit: 100, sort: "POSITION_ASC", includeUntracked: false
  }), error => error === generated);
  const page = queries.map(sqlText).find((text) => text.includes("latest_slice_position"));
  assert.ok(page);
  assert.match(page, /MAX\(\(observed_at AT TIME ZONE 'UTC'\)::date\)/u);
  assert.match(page, /ORDER BY latest_slice_position ASC NULLS LAST/u);
  assert.match(page, /keyword\.is_tracked = TRUE/u);
});
