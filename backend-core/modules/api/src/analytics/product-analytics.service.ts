import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import {
  parseAnalyticsActivityBatch,
  type AnalyticsActivityBatch,
  type AnalyticsCohort,
  type AnalyticsFeature,
  type AnalyticsReportQuery,
  type ProductAnalyticsReport,
} from "@seo-platform/contracts";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { DomainError, validationError } from "../common/domain-error.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  analyticsHistogramP95,
  analyticsMasks,
  analyticsNumber as n,
  analyticsPeriod,
  analyticsTotals,
  emptyAnalyticsTotals,
} from "./analytics-presentation.js";

type Row = Record<string, unknown>;
export type ActivityReport = Pick<
  ProductAnalyticsReport,
  "since" | "audience" | "daily" | "features" | "cohorts" | "quality"
>;

@Injectable()
export class ProductAnalyticsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ProductAnalyticsService.name);
  private timer?: ReturnType<typeof setInterval>;
  private sweeping = false;
  private readonly admission = new Map<string, { at: number; count: number }>();
  private lastAdmissionSweep = 0;
  public constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  public async ingest(
    userId: string,
    value: unknown,
  ): Promise<{ accepted: number }> {
    let batch: AnalyticsActivityBatch;
    try {
      batch = parseAnalyticsActivityBatch(value);
    } catch {
      throw validationError(
        "batch",
        "INVALID_ANALYTICS_BATCH",
        "Некорректная пачка активности",
      );
    }
    const now = Date.now(),
      rate = this.admission.get(userId);
    if (rate && rate.at > now - 60_000 && rate.count >= 12)
      throw new DomainError({
        statusCode: 429,
        code: "RATE_LIMITED",
        message: "Activity batches are arriving too frequently",
      });
    if (now - this.lastAdmissionSweep >= 60_000) {
      for (const [id, row] of this.admission)
        if (row.at < now - 60_000) this.admission.delete(id);
      this.lastAdmissionSweep = now;
    }
    if (this.admission.size >= 50_000 && !rate)
      throw new DomainError({
        statusCode: 429,
        code: "RATE_LIMITED",
        message: "Activity ingestion is busy",
      });
    this.admission.set(userId, {
      at: rate && rate.at > now - 60_000 ? rate.at : now,
      count: rate && rate.at > now - 60_000 ? rate.count + 1 : 1,
    });
    if (batch.projectId) {
      const context = await this.authorization.forProject(
        userId,
        batch.projectId,
        "project.view",
      );
      if (batch.workspaceId && context.workspaceId !== batch.workspaceId)
        throw new DomainError({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Activity scope mismatch",
        });
      batch = { ...batch, workspaceId: context.workspaceId };
    } else if (batch.workspaceId)
      await this.authorization.forWorkspace(
        userId,
        batch.workspaceId,
        "workspace.view",
      );
    const rows = await this.prisma.$transaction(
      async (database) => {
        await database.$executeRaw`SET LOCAL statement_timeout = '3s'`;
        return database.$queryRaw<
          { accepted: number }[]
        >`SELECT public.ingest_product_analytics(${userId}::uuid,${batch.sessionId}::uuid,${JSON.stringify({ workspaceId: batch.workspaceId, projectId: batch.projectId })}::jsonb,${JSON.stringify(batch.intervals.map((interval) => analyticsMasks(interval, batch)))}::jsonb,${JSON.stringify(batch.events)}::jsonb) AS accepted`;
      },
      { timeout: 5000, maxWait: 1000 },
    );
    return { accepted: n(rows[0]?.accepted) };
  }

  public async report(
    query: AnalyticsReportQuery,
    now = new Date(),
  ): Promise<ActivityReport> {
    return this.prisma.$transaction(
      async (database) => {
        await database.$executeRaw`SET LOCAL statement_timeout = '5s'`;
        return this.readReport(database, query, now);
      },
      { timeout: 15_000, maxWait: 2000, isolationLevel: "RepeatableRead" },
    );
  }
  private async readReport(
    database: Pick<PrismaService, "$queryRaw">,
    query: AnalyticsReportQuery,
    now: Date,
  ): Promise<ActivityReport> {
    const { from, before, previousFrom, today } = analyticsPeriod(
        query.days,
        now,
      ),
      include = query.includeInternal;
    const [
      daily,
      windows,
      features,
      metrics,
      retention,
      cohorts,
      coverage,
      online,
      recent,
      diagnosticGroups,
      diagnosticDays,
    ] = await Promise.all([
      database.$queryRaw<Row[]>`
        SELECT to_char(d.day,'YYYY-MM-DD') date,
          count(DISTINCT d.user_id) FILTER(WHERE d.scope_key='all' AND (d.active_seconds>=30 OR d.actions>0 OR d.results>0)) users,
          count(DISTINCT d.workspace_id) FILTER(WHERE d.active_seconds>=30 OR d.actions>0 OR d.results>0) workspaces,
          count(DISTINCT d.project_id) FILTER(WHERE d.active_seconds>=30 OR d.actions>0 OR d.results>0) projects,
          coalesce(sum(d.active_seconds) FILTER(WHERE d.scope_key='all'),0) seconds,
          coalesce(sum(d.views) FILTER(WHERE d.scope_key='all'),0) views, coalesce(sum(d.actions) FILTER(WHERE d.scope_key='all'),0) actions,
          coalesce(sum(d.results) FILTER(WHERE d.scope_key='all'),0) results,coalesce(sum(d.sessions) FILTER(WHERE d.scope_key='all'),0) sessions,
          coalesce(sum(d.errors) FILTER(WHERE d.scope_key='all'),0) errors
        FROM product_analytics_daily d JOIN product_analytics_profiles p ON p.user_id=d.user_id
        WHERE d.day>=${from}::date AND d.day<${before}::date AND (${include} OR NOT p.is_internal) GROUP BY d.day ORDER BY d.day`,
      database.$queryRaw<Row[]>`
        SELECT CASE WHEN d.day>=${from}::date THEN 'current' WHEN d.day>=${previousFrom}::date THEN 'previous' ELSE 'baseline' END AS "window",
          count(DISTINCT d.user_id) FILTER(WHERE d.scope_key='all' AND (d.active_seconds>=30 OR d.actions>0 OR d.results>0)) users,
          count(DISTINCT d.workspace_id) FILTER(WHERE d.active_seconds>=30 OR d.actions>0 OR d.results>0) workspaces,
          count(DISTINCT d.project_id) FILTER(WHERE d.active_seconds>=30 OR d.actions>0 OR d.results>0) projects,
          coalesce(sum(d.active_seconds) FILTER(WHERE d.scope_key='all'),0) seconds,coalesce(sum(d.views) FILTER(WHERE d.scope_key='all'),0) views,
          coalesce(sum(d.actions) FILTER(WHERE d.scope_key='all'),0) actions,coalesce(sum(d.results) FILTER(WHERE d.scope_key='all'),0) results,
          coalesce(sum(d.sessions) FILTER(WHERE d.scope_key='all'),0) sessions,coalesce(sum(d.errors) FILTER(WHERE d.scope_key='all'),0) errors,
          count(DISTINCT d.user_id) FILTER(WHERE d.scope_key='all' AND d.day>=${today}::date AND (d.active_seconds>=30 OR d.actions>0 OR d.results>0)) dau,
          count(DISTINCT d.user_id) FILTER(WHERE d.scope_key='all' AND d.day>=${new Date(today.getTime() - 6 * 86_400_000)}::date AND (d.active_seconds>=30 OR d.actions>0 OR d.results>0)) wau,
          count(DISTINCT d.user_id) FILTER(WHERE d.scope_key='all' AND d.day>=${new Date(today.getTime() - 29 * 86_400_000)}::date AND (d.active_seconds>=30 OR d.actions>0 OR d.results>0)) mau
        FROM product_analytics_daily d JOIN product_analytics_profiles p ON p.user_id=d.user_id
        WHERE d.day>=${new Date(Math.min(previousFrom.getTime(), today.getTime() - 29 * 86_400_000))}::date AND d.day<${before}::date AND (${include} OR NOT p.is_internal) GROUP BY 1`,
      database.$queryRaw<Row[]>`
        SELECT d.section,count(DISTINCT d.user_id) FILTER(WHERE d.active_seconds>=30 OR d.actions>0 OR d.results>0) users,
          count(DISTINCT d.workspace_id) FILTER(WHERE d.active_seconds>=30 OR d.actions>0 OR d.results>0) workspaces,
          count(DISTINCT d.project_id) FILTER(WHERE d.active_seconds>=30 OR d.actions>0 OR d.results>0) projects,
          sum(d.active_seconds) seconds,sum(d.views) views,sum(d.actions) actions,sum(d.results) results,sum(d.errors) errors
        FROM product_analytics_daily d JOIN product_analytics_profiles p ON p.user_id=d.user_id
        WHERE d.day>=${from}::date AND d.day<${before}::date AND d.scope_key<>'all' AND (${include} OR NOT p.is_internal) GROUP BY d.section ORDER BY seconds DESC`,
      database.$queryRaw<Row[]>`
        WITH selected AS MATERIALIZED (
          SELECT m.* FROM product_analytics_metrics m JOIN product_analytics_profiles p ON p.user_id=m.user_id
          WHERE m.day>=${from}::date AND m.day<${before}::date AND (${include} OR NOT p.is_internal)
        ), totals AS (SELECT section,kind,sum(count) count,sum(total_value) value FROM selected GROUP BY section,kind),
        bins AS (SELECT section,kind,ordinal,sum(coalesce((histogram->>ordinal)::bigint,0)) count FROM selected CROSS JOIN generate_series(0,10) ordinal GROUP BY section,kind,ordinal)
        SELECT t.section,t.kind,t.count,t.value,jsonb_agg(b.count ORDER BY b.ordinal) histogram FROM totals t JOIN bins b USING(section,kind) GROUP BY t.section,t.kind,t.count,t.value`,
      database.$queryRaw<Row[]>`
        SELECT offset_days, count(p.user_id) FILTER(WHERE p.first_active_day+offset_days<=${today}::date) eligible,
          count(p.user_id) FILTER(WHERE p.first_active_day+offset_days<=${today}::date AND EXISTS(
            SELECT 1 FROM product_analytics_daily d WHERE d.user_id=p.user_id AND d.day=p.first_active_day+offset_days AND d.scope_key='all' AND (d.active_seconds>=30 OR d.actions>0 OR d.results>0))) returned
        FROM (VALUES(1),(7),(30)) offsets(offset_days) LEFT JOIN product_analytics_profiles p
          ON p.first_active_day>=${from}::date AND p.first_active_day<${before}::date AND (${include} OR NOT p.is_internal) GROUP BY offset_days`,
      database.$queryRaw<Row[]>`
        SELECT to_char(date_trunc('week',p.first_active_day),'YYYY-MM-DD') week,offset_weeks,count(*) users,
          count(*) FILTER(WHERE p.first_active_day+(offset_weeks+1)*7<=${today}::date OR offset_weeks=0) eligible,
          count(*) FILTER(WHERE (p.first_active_day+(offset_weeks+1)*7<=${today}::date OR offset_weeks=0) AND EXISTS(
            SELECT 1 FROM product_analytics_daily d WHERE d.user_id=p.user_id AND d.scope_key='all'
              AND d.day>=p.first_active_day+offset_weeks*7 AND d.day<p.first_active_day+(offset_weeks+1)*7
              AND (d.active_seconds>=30 OR d.actions>0 OR d.results>0))) returned
        FROM product_analytics_profiles p CROSS JOIN generate_series(0,8) offset_weeks
        WHERE p.first_active_day>=${from}::date AND p.first_active_day<${before}::date AND (${include} OR NOT p.is_internal) GROUP BY 1,2 ORDER BY 1,2`,
      database.$queryRaw<
        { since: Date | null }[]
      >`SELECT min(created_at) since FROM product_analytics_profiles WHERE (${include} OR NOT is_internal)`,
      database.$queryRaw<
        { count: bigint }[]
      >`SELECT count(DISTINCT s.user_id) count FROM product_analytics_sessions s JOIN product_analytics_profiles p ON p.user_id=s.user_id WHERE s.last_at>=${new Date(now.getTime() - 120_000)} AND (${include} OR NOT p.is_internal)`,
      database.$queryRaw<Row[]>`
        SELECT count(DISTINCT d.user_id) FILTER(WHERE d.day>=${today}::date) dau,
          count(DISTINCT d.user_id) FILTER(WHERE d.day>=${new Date(today.getTime() - 6 * 86_400_000)}::date) wau,
          count(DISTINCT d.user_id) mau
        FROM product_analytics_daily d JOIN product_analytics_profiles p ON p.user_id=d.user_id
        WHERE d.scope_key='all' AND d.day>=${new Date(today.getTime() - 29 * 86_400_000)}::date AND d.day<${before}::date
          AND (d.active_seconds>=30 OR d.actions>0 OR d.results>0) AND (${include} OR NOT p.is_internal)`,
      database.$queryRaw<
        { service: string; code: string; count: bigint }[]
      >`SELECT service,coalesce(context->>'errorCode',code) code,count(*) count FROM operational_error_events WHERE occurred_at>=greatest(${from},now()-interval '15 days') AND occurred_at<${before} GROUP BY service,coalesce(context->>'errorCode',code) ORDER BY count(*) DESC LIMIT 50`,
      database.$queryRaw<
        { date: string; count: bigint }[]
      >`SELECT to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD') date,count(*) count FROM operational_error_events WHERE occurred_at>=greatest(${from},now()-interval '15 days') AND occurred_at<${before} GROUP BY 1 ORDER BY 1`,
    ]);
    const metricMap = new Map(
      metrics.map((row) => [`${row.section}:${row.kind}`, row]),
    );
    const featureRows = new Map(
      features.map((row) => [String(row.section), row]),
    );
    for (const metric of metrics)
      if (
        !featureRows.has(String(metric.section)) &&
        (metric.kind === "API_TIMING" || metric.kind === "API_ERROR")
      )
        featureRows.set(String(metric.section), {
          ...emptyAnalyticsTotals(),
          section: metric.section,
        });
    const histogram = (rows: Row[]) =>
      rows.reduce((bins, row) => {
        ((row.histogram as unknown[]) ?? []).forEach((value, index) => {
          bins[index] = (bins[index] ?? 0) + n(value);
        });
        return bins;
      }, Array<number>(11).fill(0));
    const summed = (kind: string) => metrics.filter((row) => row.kind === kind);
    const sum = (rows: Row[], key: string) =>
      rows.reduce((sum, row) => sum + n(row[key]), 0);
    const timing = summed("API_TIMING"),
      interactions = summed("INTERACTION"),
      lcp = summed("LCP"),
      cls = summed("CLS");
    const current = windows.find((row) => row.window === "current"),
      previous = windows.find((row) => row.window === "previous");
    const cohortMap = new Map<string, AnalyticsCohort>();
    for (const row of cohorts) {
      const week = String(row.week),
        existing = cohortMap.get(week) ?? {
          week,
          users: n(row.users),
          weeks: [],
        };
      cohortMap.set(week, {
        ...existing,
        weeks: [
          ...existing.weeks,
          { eligible: n(row.eligible), returned: n(row.returned) },
        ],
      });
    }
    const r = (days: number) => {
      const row = retention.find((row) => Number(row.offset_days) === days);
      return { eligible: n(row?.eligible), returned: n(row?.returned) };
    };
    return {
      since: coverage[0]?.since?.toISOString() ?? null,
      audience: {
        dau: n(recent[0]?.dau),
        wau: n(recent[0]?.wau),
        mau: n(recent[0]?.mau),
        online: n(online[0]?.count),
        current: analyticsTotals(current),
        previous: analyticsTotals(previous),
        d1: r(1),
        d7: r(7),
        d30: r(30),
      },
      daily: Array.from({ length: query.days }, (_, index) => {
        const date = new Date(from.getTime() + index * 86_400_000)
          .toISOString()
          .slice(0, 10);
        return {
          date,
          ...analyticsTotals(daily.find((row) => row.date === date)),
        };
      }),
      features: [...featureRows.values()].map((row) => {
        const metric = metricMap.get(`${row.section}:API_TIMING`),
          errors = metricMap.get(`${row.section}:API_ERROR`);
        return {
          ...analyticsTotals({ ...emptyAnalyticsTotals(), ...row }),
          section: String(row.section) as AnalyticsFeature["section"],
          requests: n(metric?.count),
          requestErrors: n(errors?.count),
          latencyP95Ms: metric
            ? analyticsHistogramP95(histogram([metric]))
            : null,
          latencyAverageMs:
            metric && n(metric.count) > 0
              ? Math.round(n(metric.value) / n(metric.count))
              : null,
        };
      }),
      cohorts: [...cohortMap.values()],
      quality: {
        apiRequests: sum(timing, "count"),
        apiErrors: sum(summed("API_ERROR"), "count"),
        apiP95Ms: analyticsHistogramP95(histogram(timing)),
        lcpAverageMs: sum(lcp, "count")
          ? Math.round(sum(lcp, "value") / sum(lcp, "count"))
          : null,
        clsAverageMilli: sum(cls, "count")
          ? Math.round(sum(cls, "value") / sum(cls, "count"))
          : null,
        interactionP95Ms: analyticsHistogramP95(histogram(interactions)),
        serverErrors: diagnosticGroups.map((row) => ({
          service: row.service,
          code: row.code,
          count: n(row.count),
        })),
        serverErrorDaily: diagnosticDays.map((row) => ({
          date: row.date,
          count: n(row.count),
        })),
      },
    };
  }

  public onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.purge(), 300_000);
    this.timer.unref();
  }
  public onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
  public async purge(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const deadline = Date.now() + 2000;
      for (let round = 0; round < 10 && Date.now() < deadline; round++) {
        const deleted = await this.prisma.$transaction(
          async (database) => {
            await database.$executeRaw`SET LOCAL statement_timeout = '1s'`;
            const counts = [];
            counts.push(
              await database.$executeRaw`DELETE FROM product_analytics_receipts WHERE event_id IN (SELECT event_id FROM product_analytics_receipts WHERE occurred_at<now()-interval '2 days' ORDER BY occurred_at LIMIT 10000)`,
            );
            counts.push(
              await database.$executeRaw`DELETE FROM product_analytics_buckets WHERE (user_id,minute_at,scope_key) IN (SELECT user_id,minute_at,scope_key FROM product_analytics_buckets WHERE minute_at<now()-interval '2 days' ORDER BY minute_at LIMIT 10000)`,
            );
            counts.push(
              await database.$executeRaw`DELETE FROM product_analytics_sessions WHERE (user_id,session_id) IN (SELECT user_id,session_id FROM product_analytics_sessions WHERE last_at<now()-interval '90 days' ORDER BY last_at LIMIT 10000)`,
            );
            counts.push(
              await database.$executeRaw`DELETE FROM product_analytics_daily WHERE (day,user_id,scope_key) IN (SELECT day,user_id,scope_key FROM product_analytics_daily WHERE day<current_date-400 ORDER BY day LIMIT 10000)`,
            );
            counts.push(
              await database.$executeRaw`DELETE FROM product_analytics_metrics WHERE (day,user_id,section,kind) IN (SELECT day,user_id,section,kind FROM product_analytics_metrics WHERE day<current_date-400 ORDER BY day LIMIT 10000)`,
            );
            return counts;
          },
          { timeout: 5000, maxWait: 500 },
        );
        if (deleted.every((count) => count < 10_000)) break;
      }
    } catch {
      this.logger.warn("Product analytics retention sweep unavailable");
    } finally {
      this.sweeping = false;
    }
  }
}
