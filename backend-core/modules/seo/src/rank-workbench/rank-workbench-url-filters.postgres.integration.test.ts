import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRankPositionReport,
  parseRankPositionReportInput,
  parseSerpWorkbenchReport,
} from "@seo-platform/contracts";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { KeywordService } from "../keywords/keyword.service.js";
import { SemanticVersionService } from "../semantic-versions/semantic-version.service.js";
import { RankWorkbenchService } from "./rank-workbench.service.js";
import { createRankWorkbenchFixture } from "./rank-workbench.fixtures.js";

const databaseUrl = process.env.SEO_DATA_URL_FILTER_TEST_DATABASE_URL;
test(
  "real PostgreSQL URL filters, sorts and cursors agree with the saved latest SERP",
  { skip: !databaseUrl, timeout: 90_000 },
  async () => {
    assert.ok(databaseUrl);
    const url = new URL(databaseUrl);
    assert.ok(
      ["localhost", "127.0.0.1"].includes(url.hostname) &&
        url.port &&
        url.port !== "5432",
      "Disposable cluster only",
    );
    const prisma = new PrismaService(
      loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl }),
    );
    try {
      const [scope] = await prisma.$queryRaw<
        { workspaceId: string; projectId: string; actorId: string }[]
      >`SELECT uuidv7() AS "workspaceId", uuidv7() AS "projectId", uuidv7() AS "actorId"`;
      assert.ok(scope);
      const fixture = await createRankWorkbenchFixture(
        prisma,
        scope,
        "sql-url-filters.example.invalid",
        210,
      );
      const keywordService = new KeywordService(
        prisma,
        new SemanticVersionService(prisma),
      );
      const base = {
        limit: 100,
        metricProjection: [] as const,
        rankColumnKeys: [] as const,
        sort: "TEXT_ASC" as const,
      };
      const multiple = await keywordService.list(
        scope.workspaceId,
        scope.projectId,
        { ...base, multipleUrlsState: "MULTIPLE" },
        "url-filter",
      );
      assert.deepEqual(
        multiple.data.map((row) => row.textOriginal).sort(),
        [fixture.texts[0], fixture.texts[3], fixture.texts[4]].sort(),
      );
      assert.equal(multiple.page.totalApprox, 3);
      const single = await keywordService.list(
        scope.workspaceId,
        scope.projectId,
        { ...base, multipleUrlsState: "NOT_MULTIPLE" },
        "url-filter",
      );
      assert.equal(single.page.totalApprox, 207);
      assert.ok(
        single.data.some((row) => row.textOriginal === fixture.texts[2]),
        "old multiple pages must not override the newest single-page snapshot",
      );
      const empty = await keywordService.list(
        scope.workspaceId,
        scope.projectId,
        { ...base, targetUrlState: "EMPTY" },
        "url-filter",
      );
      assert.deepEqual(
        empty.data.map((row) => row.textOriginal),
        [fixture.texts[1]],
      );
      for (const sort of [
        "TARGET_URL_ASC",
        "TARGET_URL_DESC",
        "TARGET_URL_SET_FIRST",
        "TARGET_URL_EMPTY_FIRST",
      ] as const) {
        let cursor: string | undefined;
        const seen = new Set<string>();
        const ordered: { id: string; targetUrl?: string }[] = [];
        do {
          const result = await keywordService.list(
            scope.workspaceId,
            scope.projectId,
            { ...base, sort, limit: 37, ...(cursor ? { cursor } : {}) },
            "url-sort",
          );
          for (const row of result.data) {
            assert.equal(seen.has(row.id), false);
            seen.add(row.id);
            ordered.push(row);
          }
          cursor = result.page.nextCursor;
        } while (cursor);
        assert.equal(
          seen.size,
          210,
          sort + " must not omit or repeat rows at cursor boundaries",
        );
        if (sort === "TARGET_URL_ASC" || sort === "TARGET_URL_DESC") {
          const urls = ordered.flatMap((row) =>
            row.targetUrl ? [row.targetUrl] : [],
          );
          const expected = [...urls].sort();
          if (sort === "TARGET_URL_DESC") expected.reverse();
          assert.deepEqual(
            urls,
            expected,
            sort + " must sort before pagination",
          );
          assert.equal(ordered.at(-1)?.targetUrl, undefined);
        } else {
          assert.equal(
            (sort === "TARGET_URL_EMPTY_FIRST" ? ordered[0] : ordered.at(-1))
              ?.targetUrl,
            undefined,
          );
        }
      }
      const workbench = new RankWorkbenchService(prisma);
      const input = parseRankPositionReportInput({
        mode: "SEO",
        dimensionKey: fixture.moscow,
        observedFrom: fixture.older.slice(0, 10) + "T00:00:00.000Z",
        observedBefore: new Date(
          Date.parse(fixture.latest) + 86_400_000,
        ).toISOString(),
        dateLimit: 31,
        limit: 100,
        sort: "TARGET_URL_ASC",
        includeUntracked: true,
        multipleUrlsState: "MULTIPLE",
      });
      const result = parseRankPositionReport(
        await workbench.positions(scope, input),
      );
      assert.deepEqual(
        result.rows.map((row) => row.query).sort(),
        [fixture.texts[0], fixture.texts[4]].sort(),
      );
      assert.equal(result.summary.keywordCount, 2);
      assert.ok(
        result.rows.every((row) => (row.cells[0]?.siteResultCount ?? 0) > 1),
        "the filter and the newest matrix cell must agree, including www aliases",
      );
      assert.ok(
        result.trend.every((point) => point.measured === 2),
        "trend and matrix must use the same filtered keyword set",
      );
      const missing = parseRankPositionReport(
        await workbench.positions(scope, {
          ...input,
          multipleUrlsState: "NOT_MULTIPLE",
          targetUrlState: "EMPTY",
        }),
      );
      assert.deepEqual(
        missing.rows.map((row) => row.query),
        [fixture.texts[1]],
      );
      const spb = parseRankPositionReport(
        await workbench.positions(scope, {
          ...input,
          dimensionKey: fixture.spb,
        }),
      );
      assert.deepEqual(
        spb.rows.map((row) => row.query),
        [fixture.texts[3]],
      );
      const [another] = await prisma.$queryRaw<
        { workspaceId: string; projectId: string }[]
      >`SELECT uuidv7() AS "workspaceId", uuidv7() AS "projectId"`;
      assert.ok(another);
      const foreign = await workbench.positions(another, input);
      assert.equal(foreign.rows.length, 0);
      assert.equal(foreign.summary.keywordCount, 0);

      // The observer reads real PostgreSQL counters, never replaces API/SQL results.
      const diagnosticsUrl = new URL(databaseUrl); diagnosticsUrl.pathname = "/jobs_db";
      const diagnostics = new PrismaService(loadAppConfig({ NODE_ENV: "test", DATABASE_URL: diagnosticsUrl.href }));
      async function preparationCalls(): Promise<bigint> {
        const [row] = await diagnostics.$queryRaw<{ calls: bigint }[]>`
          SELECT COALESCE(sum(calls), 0)::bigint AS calls FROM diagnostics.pg_stat_statements
          WHERE dbid = (SELECT oid FROM pg_database WHERE datname = 'seo_db')
            AND query LIKE '%array_agg(id ORDER BY%' AND query LIKE '%FROM projected%'
        `;
        return row!.calls;
      }
      try {
        const { multipleUrlsState: _multiple, ...fullFilters } = input;
        void _multiple;
        const fullInput = { ...fullFilters, limit: 50 as const };
        const before = await preparationCalls();
        let next = parseRankPositionReport(await workbench.positions(scope, fullInput));
        const afterFirst = await preparationCalls();
        assert.equal(afterFirst - before, 1n);
        const ids = new Set(next.rows.map(row => row.keywordId));
        const firstSummary = next.summary;
        while (next.page.nextCursor) {
          next = parseRankPositionReport(await workbench.positions(scope, { ...fullInput, cursor: next.page.nextCursor }));
          assert.deepEqual(next.summary, firstSummary, "same frozen summary on every page");
          for (const row of next.rows) { assert.equal(ids.has(row.keywordId), false); ids.add(row.keywordId); }
        }
        assert.equal(ids.size, 210);
        assert.equal(await preparationCalls(), afterFirst, "next pages must not rebuild the project projection");
        for (const sort of ["POSITION_ASC", "POSITION_DESC", "OBSERVED_DESC", "CHANGE_ASC", "CHANGE_DESC", "QUERY_ASC", "TARGET_URL_DESC", "TARGET_URL_SET_FIRST", "TARGET_URL_EMPTY_FIRST"] as const) {
          const seen = new Set<string>();
          let cursor: string | undefined;
          do {
            const page = parseRankPositionReport(await workbench.positions(scope, { ...fullInput, sort, ...(cursor ? { cursor } : {}) }));
            for (const row of page.rows) { assert.equal(seen.has(row.keywordId), false); seen.add(row.keywordId); }
            cursor = page.page.nextCursor;
          } while (cursor);
          assert.equal(seen.size, 210, sort);
        }
        const serpInput = { dimensionKeys: [fixture.moscow], limit: 50 as const };
        let cursor: string | undefined;
        const serpIds = new Set<string>();
        do {
          const page = parseSerpWorkbenchReport(await workbench.serp(scope, { ...serpInput, ...(cursor ? { cursor } : {}) }));
          for (const row of page.rows) { assert.equal(serpIds.has(row.keywordId), false); serpIds.add(row.keywordId); }
          cursor = page.page.nextCursor;
        } while (cursor);
        assert.equal(serpIds.size, 210);
      } finally { await diagnostics.$disconnect(); }
    } finally {
      await prisma.$disconnect();
    }
  },
);
