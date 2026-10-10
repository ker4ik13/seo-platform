import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaService } from "../database/prisma.service.js";
import { loadAppConfig } from "../config/app-config.js";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { ProductAnalyticsService } from "./product-analytics.service.js";
import { parseProductAnalyticsReport } from "@seo-platform/contracts";

const url = process.env.PLATFORM_ANALYTICS_TEST_DATABASE_URL;
test(
  "real PostgreSQL unions overlapping tabs, deduplicates receipts and enforces tenant scope",
  { skip: !url, timeout: 60_000 },
  async (t) => {
    assert.ok(url);
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "127.0.0.1");
    assert.notEqual(parsed.port, "5432");
    const prisma = new PrismaService(
      loadAppConfig({ NODE_ENV: "test", DATABASE_URL: url }),
    );
    try {
      const id = randomUUID(),
        email = `analytics-${id}@analytics.test`;
      const user = await prisma.user.create({
        data: {
          id,
          emailNormalized: email,
          emailDisplay: email,
          displayName: "Analytics SQL test",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });
      const workspace = await prisma.workspace.create({
        data: {
          name: "Analytics SQL",
          slug: randomUUID(),
          ownerUserId: user.id,
        },
      });
      await prisma.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          roleCode: "OWNER",
          status: "ACTIVE",
        },
      });
      const service = new ProductAnalyticsService(
          prisma,
          new AuthorizationService(prisma),
        ),
        minute = Math.floor(Date.now() / 60_000) * 60_000 - 120_000,
        sessionId = randomUUID();
      const batch = (offset: number, section: string) => ({
        version: 1,
        sessionId,
        workspaceId: workspace.id,
        intervals: [
          {
            id: randomUUID(),
            startedAt: new Date(minute + offset * 1000).toISOString(),
            durationMs: 40_000,
            section,
          },
        ],
        events: [
          {
            id: randomUUID(),
            occurredAt: new Date(minute).toISOString(),
            section,
            kind: "PAGE_VIEW",
            count: 1,
            value: 0,
          },
        ],
      });
      const first = batch(0, "SEMANTICS"),
        second = batch(20, "RANKINGS");
      await Promise.all([
        service.ingest(user.id, first),
        service.ingest(user.id, second),
      ]);
      assert.equal((await service.ingest(user.id, first)).accepted, 0);
      const rows = await prisma.$queryRaw<
        { seconds: bigint; views: bigint; sessions: bigint }[]
      >`SELECT sum(active_seconds)::bigint seconds,sum(views)::bigint views,sum(sessions)::bigint sessions FROM product_analytics_daily WHERE user_id=${user.id}::uuid AND scope_key='all'`;
      assert.deepEqual(rows[0], { seconds: 60n, views: 2n, sessions: 1n });
      const profileVersion = await prisma.$queryRaw<
        { version: string }[]
      >`SELECT xmin::text version FROM product_analytics_profiles WHERE user_id=${user.id}::uuid`;
      for (let index = 0; index < 2; index++) {
        await service.ingest(user.id, {
          version: 1,
          sessionId,
          workspaceId: workspace.id,
          intervals: [],
          events: [
            {
              id: randomUUID(),
              occurredAt: new Date(minute).toISOString(),
              section: "OTHER",
              kind: "API_TIMING",
              count: 1,
              value: 200,
              histogram: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
            },
          ],
        });
      }
      const versionAfterMetrics = await prisma.$queryRaw<
        { version: string }[]
      >`SELECT xmin::text version FROM product_analytics_profiles WHERE user_id=${user.id}::uuid`;
      assert.equal(
        versionAfterMetrics[0]?.version,
        profileVersion[0]?.version,
        "timing must not rewrite an unchanged activity profile",
      );
      const emptyScopes = await prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) count FROM product_analytics_daily WHERE user_id=${user.id}::uuid AND section='OTHER'`;
      assert.equal(
        emptyScopes[0]?.count,
        0n,
        "timing does not create daily counter rows",
      );
      const redundantMetrics = await prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) count FROM product_analytics_metrics WHERE kind IN ('PAGE_VIEW','ACTION','RESULT_VIEW','CLIENT_ERROR')`;
      assert.equal(
        redundantMetrics[0]?.count,
        0n,
        "daily counters must not be duplicated in histograms",
      );
      const oldReceipt = randomUUID();
      await prisma.$executeRaw`INSERT INTO product_analytics_receipts VALUES(${oldReceipt}::uuid,${user.id}::uuid,now()-interval '3 days')`;
      await prisma.$executeRaw`INSERT INTO product_analytics_buckets VALUES(${user.id}::uuid,now()-interval '3 days','expired',1)`;
      await service.purge();
      const expired = await prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) count FROM product_analytics_receipts WHERE event_id=${oldReceipt}::uuid`;
      assert.equal(expired[0]?.count, 0n);
      assert.equal(
        (await service.ingest(user.id, first)).accepted,
        0,
        "retention must preserve the accepted retry window",
      );
      const report = await service.report({ days: 7, includeInternal: false });
      assert.equal(report.audience.wau, 1);
      assert.equal(report.audience.mau, 1);
      assert.equal(report.audience.current.seconds, 60);
      assert.equal(
        report.features.find((row) => row.section === "SEMANTICS")?.seconds,
        40,
      );
      assert.throws(() =>
        parseProductAnalyticsReport({
          ...report,
          version: 1,
          generatedAt: new Date().toISOString(),
          period: {
            days: 7,
            from: new Date().toISOString(),
            before: new Date().toISOString(),
            timezone: "UTC",
            includeInternal: false,
          },
          lifecycle: [],
          activation: {
            registered: 1,
            verified: 1,
            engaged: 1,
            resultViewed: 0,
            timeToValueMedianMs: null,
          },
          operations: null,
          quality: report.quality,
          degraded: [],
          finance: { secret: true },
        }),
      );
      await assert.rejects(
        service.ingest(user.id, {
          ...batch(0, "OTHER"),
          workspaceId: randomUUID(),
        }),
      );
      await assert.rejects(
        service.ingest(user.id, { ...batch(0, "OTHER"), userId: randomUUID() }),
      );
      const seeded = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO users(id,email_normalized,email_display,display_name,status,updated_at)
      SELECT uuidv7(),'bench-'||ordinal||'-'||${randomUUID()}||'@analytics.test','benchmark@analytics.test','Analytics benchmark','ACTIVE'::"UserStatus",now()
      FROM generate_series(1,1000) ordinal RETURNING id`;
      const ids = seeded.map((row) => row.id);
      await prisma.$executeRaw`INSERT INTO product_analytics_profiles(user_id,is_internal,first_active_day,last_active_day) SELECT id,FALSE,current_date-29,current_date FROM unnest(${ids}::uuid[]) id`;
      await prisma.$executeRaw`
      INSERT INTO product_analytics_daily(day,user_id,scope_key,section,active_seconds,views,actions,sessions)
      SELECT current_date-offset_days,id,scope_key,section,seconds,1,1,CASE WHEN scope_key='all' THEN 1 ELSE 0 END
      FROM unnest(${ids}::uuid[]) id CROSS JOIN generate_series(0,29) offset_days
      CROSS JOIN (VALUES('all','ALL',3600),('benchmark-semantics','SEMANTICS',1800),('benchmark-rankings','RANKINGS',1800)) scopes(scope_key,section,seconds)`;
      const started = performance.now(),
        large = await service.report({ days: 30, includeInternal: false });
      const elapsed = performance.now() - started;
      assert.equal(
        large.audience.mau,
        1001,
        "monthly unique users must not sum 30 daily counts",
      );
      assert.equal(large.daily.length, 30);
      assert.ok(
        JSON.stringify(large).length < 100_000,
        "only aggregates cross the report boundary",
      );
      assert.ok(
        elapsed < 5000,
        `analytics read exceeded the 5s budget: ${elapsed}ms`,
      );
      t.diagnostic(
        `analytics benchmark: 1000 users, 90000 daily scope facts, report ${Math.round(elapsed)}ms`,
      );
      const ingestStarted = performance.now();
      let nextUser = 0;
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (nextUser < ids.length) {
            const userId = ids[nextUser++]!;
            await service.ingest(userId, {
              version: 1,
              sessionId: randomUUID(),
              intervals: [
                {
                  id: randomUUID(),
                  startedAt: new Date(minute).toISOString(),
                  durationMs: 40_000,
                  section: "DASHBOARD",
                },
              ],
              events: [
                {
                  id: randomUUID(),
                  occurredAt: new Date(minute).toISOString(),
                  section: "DASHBOARD",
                  kind: "API_TIMING",
                  count: 1,
                  value: 200,
                  histogram: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
                },
              ],
            });
          }
        }),
      );
      t.diagnostic(
        `analytics ingestion: 1000 real batches, concurrency 4, ${Math.round(performance.now() - ingestStarted)}ms`,
      );
    } finally {
      await prisma.$disconnect();
    }
  },
);
