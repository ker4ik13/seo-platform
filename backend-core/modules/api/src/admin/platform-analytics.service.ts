import { Injectable } from "@nestjs/common";
import type {
  AnalyticsFinance,
  AnalyticsLifecycleDay,
  AnalyticsReportQuery,
  ProductAnalyticsReport,
} from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { ProductAnalyticsService } from "../analytics/product-analytics.service.js";
import {
  analyticsNumber as n,
  analyticsPeriod,
} from "../analytics/analytics-presentation.js";

@Injectable()
export class PlatformAnalyticsService {
  private readonly cache = new Map<
    string,
    { until: number; value: ProductAnalyticsReport }
  >();
  private readonly pending = new Map<string, Promise<ProductAnalyticsReport>>();
  public constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ProductAnalyticsService,
    private readonly jobs: JobsClient,
  ) {}
  public async report(
    query: AnalyticsReportQuery,
    finance: boolean,
    actorId: string,
    requestId: string,
  ): Promise<ProductAnalyticsReport> {
    const key = JSON.stringify([query, finance]),
      cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const promise = this.read(query, finance, actorId, requestId);
    this.pending.set(key, promise);
    try {
      const value = await promise;
      this.cache.set(key, { until: Date.now() + 300_000, value });
      return value;
    } finally {
      this.pending.delete(key);
    }
  }
  private async read(
    query: AnalyticsReportQuery,
    financeAllowed: boolean,
    actorId: string,
    requestId: string,
  ): Promise<ProductAnalyticsReport> {
    const now = new Date(),
      { from, before } = analyticsPeriod(query.days, now);
    const internalUsers = query.includeInternal
      ? []
      : await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE email_normalized LIKE '%@example.invalid'
      UNION SELECT user_id AS id FROM platform_staff_role_assignments WHERE revoked_at IS NULL LIMIT 10001`;
    if (internalUsers.length > 10_000)
      throw new Error(
        "Analytics internal segment exceeds the bounded report scope",
      );
    const excludedUsers = internalUsers.map((row) => row.id);
    const excludedWorkspaces = excludedUsers.length
      ? await this.prisma.workspace.findMany({
          where: { ownerUserId: { in: excludedUsers } },
          select: { id: true },
          take: 10_001,
        })
      : [];
    if (excludedWorkspaces.length > 10_000)
      throw new Error(
        "Analytics internal workspaces exceed the bounded report scope",
      );
    const [activity, lifecycle, operations, finance, activationRows] =
      await Promise.all([
        this.activity.report(query, now),
        this.lifecycle(from, before, excludedUsers),
        this.jobs
          .operationAnalytics(
            query.days,
            excludedWorkspaces.map((row) => row.id),
            actorId,
            requestId,
          )
          .then((value) => ({ value }))
          .catch(() => ({ value: null })),
        financeAllowed
          ? this.finance(
              from,
              before,
              excludedWorkspaces.map((row) => row.id),
            )
              .then((value) => ({ value }))
              .catch(() => ({ value: null }))
          : Promise.resolve({ value: null }),
        this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT count(*) registered,count(*) FILTER(WHERE u.email_verified_at IS NOT NULL) verified,
          count(*) FILTER(WHERE p.first_active_day IS NOT NULL) engaged,count(*) FILTER(WHERE p.first_value_at IS NOT NULL) "resultViewed",
          round((percentile_cont(0.5) WITHIN GROUP(ORDER BY greatest(0,extract(epoch FROM p.first_value_at-u.created_at)*1000)) FILTER(WHERE p.first_value_at IS NOT NULL))::numeric)::bigint "timeToValueMedianMs"
        FROM users u LEFT JOIN product_analytics_profiles p ON p.user_id=u.id WHERE u.created_at>=${from} AND u.created_at<${before} AND NOT(u.id=ANY(${excludedUsers}::uuid[]))`,
      ]);
    return {
      version: 1,
      generatedAt: now.toISOString(),
      period: {
        days: query.days,
        from: from.toISOString(),
        before: before.toISOString(),
        timezone: "UTC",
        includeInternal: query.includeInternal,
      },
      ...activity,
      lifecycle,
      activation: {
        registered: n(activationRows[0]?.registered),
        verified: n(activationRows[0]?.verified),
        engaged: n(activationRows[0]?.engaged),
        resultViewed: n(activationRows[0]?.resultViewed),
        timeToValueMedianMs:
          activationRows[0]?.timeToValueMedianMs == null
            ? null
            : n(activationRows[0].timeToValueMedianMs),
      },
      operations: operations.value,
      ...(finance.value ? { finance: finance.value } : {}),
      degraded: [
        ...(operations.value === null ? ["OPERATIONS" as const] : []),
        ...(financeAllowed && finance.value === null
          ? ["FINANCE" as const]
          : []),
      ],
    };
  }
  private async lifecycle(
    from: Date,
    before: Date,
    excluded: readonly string[],
  ): Promise<readonly AnalyticsLifecycleDay[]> {
    const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>`
      WITH source AS (
        SELECT created_at AS occurred_at,'registered' kind FROM users WHERE created_at>=${from} AND created_at<${before} AND NOT(id=ANY(${[...excluded]}::uuid[]))
        UNION ALL SELECT email_verified_at,'verified' FROM users WHERE email_verified_at>=${from} AND email_verified_at<${before} AND NOT(id=ANY(${[...excluded]}::uuid[]))
        UNION ALL SELECT created_at,'workspaces' FROM workspaces WHERE created_at>=${from} AND created_at<${before} AND NOT(owner_user_id=ANY(${[...excluded]}::uuid[]))
        UNION ALL SELECT created_at,'projects' FROM projects WHERE created_at>=${from} AND created_at<${before} AND NOT(owner_user_id=ANY(${[...excluded]}::uuid[]))
        UNION ALL SELECT created_at,'invited' FROM workspace_invites WHERE created_at>=${from} AND created_at<${before} AND NOT(invited_by=ANY(${[...excluded]}::uuid[]))
        UNION ALL SELECT accepted_at,'accepted' FROM workspace_invites WHERE accepted_at>=${from} AND accepted_at<${before} AND NOT(invited_by=ANY(${[...excluded]}::uuid[]))
      ) SELECT to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD') date,
        count(*) FILTER(WHERE kind='registered') registered,count(*) FILTER(WHERE kind='verified') verified,
        count(*) FILTER(WHERE kind='workspaces') workspaces,count(*) FILTER(WHERE kind='projects') projects,
        count(*) FILTER(WHERE kind='invited') invited,count(*) FILTER(WHERE kind='accepted') accepted FROM source GROUP BY 1 ORDER BY 1`;
    return rows.map((row) => ({
      date: String(row.date),
      registered: n(row.registered),
      verified: n(row.verified),
      workspaces: n(row.workspaces),
      projects: n(row.projects),
      invited: n(row.invited),
      accepted: n(row.accepted),
    }));
  }
  private async finance(
    from: Date,
    before: Date,
    excluded: readonly string[],
  ): Promise<AnalyticsFinance> {
    return this.prisma.$transaction(
      async (database) => {
        await database.$executeRaw`SET LOCAL statement_timeout = '5s'`;
        return this.financeSnapshot(database, from, before, excluded);
      },
      { timeout: 15_000, maxWait: 2000, isolationLevel: "RepeatableRead" },
    );
  }
  private async financeSnapshot(
    database: Pick<PrismaService, "$queryRaw">,
    from: Date,
    before: Date,
    excluded: readonly string[],
  ): Promise<AnalyticsFinance> {
    const [subscriptions, rows] = await Promise.all([
      database.$queryRaw<{ count: bigint; value: bigint }[]>`
        SELECT count(*) count,coalesce(sum(CASE WHEN s.period='ANNUAL' THEN p.amount_minor/12 ELSE p.amount_minor END),0)::bigint value
        FROM billing_subscriptions s LEFT JOIN billing_plan_prices p ON p.plan_version_id=s.plan_version_id AND p.period=s.period AND p.currency='RUB'
        WHERE s.status IN ('ACTIVE','CANCELLING') AND s.current_period_end>now() AND s.provider IS NOT NULL AND NOT(s.workspace_id=ANY(${[...excluded]}::uuid[]))`,
      database.$queryRaw<Record<string, unknown>[]>`
      WITH payments AS (
        SELECT to_char(succeeded_at AT TIME ZONE 'UTC','YYYY-MM-DD') date,sum(amount_minor) received,count(*) payments,count(DISTINCT workspace_id) payers
        FROM billing_payments WHERE succeeded_at>=${from} AND succeeded_at<${before} AND is_test=FALSE AND status IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED')
          AND NOT(workspace_id=ANY(${[...excluded]}::uuid[])) GROUP BY 1
      ), refund_events AS (
        SELECT r.succeeded_at occurred_at,r.amount_minor amount
        FROM billing_refunds r JOIN billing_payments p ON p.id=r.payment_id WHERE r.succeeded_at>=${from} AND r.succeeded_at<${before} AND r.status='SUCCEEDED' AND p.is_test=FALSE
          AND NOT(p.workspace_id=ANY(${[...excluded]}::uuid[]))
        UNION ALL SELECT r.updated_at,r.approved_amount_minor FROM billing_refund_requests r JOIN billing_payments p ON p.id=r.payment_id
          WHERE r.updated_at>=${from} AND r.updated_at<${before} AND r.status='SUCCEEDED' AND p.provider='CRYPTO_PAY' AND p.is_test=FALSE
            AND NOT(p.workspace_id=ANY(${[...excluded]}::uuid[]))
      ), refunds AS (
        SELECT to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD') date,sum(amount) refunds FROM refund_events GROUP BY 1
      ) SELECT coalesce(p.date,r.date) date,coalesce(p.received,0) received,coalesce(r.refunds,0) refunds,coalesce(p.payments,0) payments,coalesce(p.payers,0) payers
      FROM payments p FULL JOIN refunds r USING(date) ORDER BY 1`,
    ]);
    return {
      monthlyPlanValueMinor: n(subscriptions[0]?.value),
      payingWorkspaces: n(subscriptions[0]?.count),
      daily: rows.map((row) => ({
        date: String(row.date),
        receivedMinor: n(row.received),
        refundsMinor: n(row.refunds),
        payments: n(row.payments),
        payers: n(row.payers),
      })),
    };
  }
}
