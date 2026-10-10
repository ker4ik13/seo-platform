import { Injectable } from "@nestjs/common";
import type { AdminOverview } from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import { BillingService } from "../billing/billing.service.js";

@Injectable()
export class PlatformOverviewService {
  private cached?: { expires: number; value: AdminOverview };
  private pending: Promise<AdminOverview> | undefined;
  public constructor(private readonly prisma: PrismaService, private readonly jobs: JobsClient, private readonly seo: SeoDataClient, private readonly billing: BillingService) {}
  public async overview(actorId: string, requestId: string): Promise<AdminOverview> {
    if (this.cached && this.cached.expires > Date.now()) return this.cached.value;
    if (this.pending) return this.pending;
    const pending = this.read(actorId, requestId); this.pending = pending;
    try { const value = await pending; this.cached = { value, expires: Date.now() + 30_000 }; return value; }
    finally { if (this.pending === pending) this.pending = undefined; }
  }
  private async read(actorId: string, requestId: string): Promise<AdminOverview> {
    const now = new Date(), week = new Date(now.getTime() - 7 * 86_400_000), month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 29 * 86_400_000), year = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const providerStates = Promise.allSettled([this.jobs.executionOverview(actorId, requestId), this.seo.adminOverview(actorId, requestId)] as const);
    const paidStatuses = ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
    const [users, registered7d, unverified, activeUsers, workspaces, withProjects, readOnly, projects, subscriptions, received, receivedYear, refunded, manualRefunded, pendingRefunds, pendingReceipts, pendingPayments, usageReview, daily] = await Promise.all([
      this.prisma.user.count({ where: { status: { not: "DELETED" } } }),
      this.prisma.user.count({ where: { status: { not: "DELETED" }, createdAt: { gte: week } } }),
      this.prisma.user.count({ where: { status: "PENDING_VERIFICATION" } }),
      this.prisma.$queryRaw<{count:bigint}[]>`SELECT count(DISTINCT d.user_id)::bigint count FROM product_analytics_daily d JOIN product_analytics_profiles p ON p.user_id=d.user_id WHERE d.scope_key='all' AND d.day>=${new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())-6*86_400_000)}::date AND NOT p.is_internal AND (d.active_seconds>=30 OR d.actions>0 OR d.results>0)`,
      this.prisma.workspace.count({ where: { status: { notIn: ["DELETING", "DELETED"] } } }),
      this.prisma.workspace.count({ where: { status: { notIn: ["DELETING", "DELETED"] }, projects: { some: { status: { in: ["ACTIVE", "DRAFT"] } } } } }),
      this.prisma.workspace.count({ where: { status: "READ_ONLY" } }),
      this.prisma.project.count({ where: { status: { in: ["DRAFT", "ACTIVE"] } } }),
      this.prisma.billingSubscription.findMany({ where: { status: { in: ["ACTIVE", "CANCELLING"] }, currentPeriodEnd: { gt: now }, provider: { not: null } }, include: { planVersion: { include: { prices: true } } } }),
      this.prisma.billingPayment.aggregate({ where: { isTest: false, status: { in: [...paidStatuses] }, succeededAt: { gte: month } }, _sum: { amountMinor: true } }),
      this.prisma.billingPayment.aggregate({ where: { isTest: false, status: { in: [...paidStatuses] }, succeededAt: { gte: year } }, _sum: { amountMinor: true } }),
      this.prisma.billingRefund.aggregate({ where: { status: "SUCCEEDED", succeededAt: { gte: month }, payment: { isTest: false } }, _sum: { amountMinor: true } }),
      this.prisma.billingRefundRequest.aggregate({ where: { status: "SUCCEEDED", updatedAt: { gte: month }, payment: { provider: "CRYPTO_PAY", isTest: false } }, _sum: { approvedAmountMinor: true } }),
      this.prisma.billingRefundRequest.count({ where: { status: { in: ["REQUESTED", "APPROVED", "PROCESSING", "MANUAL_REQUIRED"] } } }),
      this.prisma.npdReceiptObligation.count({ where: { status: { in: ["PENDING", "AWAITING_MANUAL_REGISTRATION", "REGISTERING", "FAILED_RETRYABLE", "FAILED_FINAL", "CANCELLATION_PENDING", "REPLACEMENT_REQUIRED"] }, payment: { isTest: false } } }),
      this.prisma.billingPayment.count({ where: { status: { in: ["CREATING", "PENDING", "FAILED_RETRYABLE"] } } }),
      Promise.all([this.prisma.billingOperationQuote.count({ where: { status: "REVIEW" } }), this.prisma.billingUsageReservation.count({ where: { status: "RESERVED", providerStartedAt: { not: null }, expiresAt: { lt: new Date(now.getTime() - 300_000) } } })]).then(counts => counts.reduce((sum, count) => sum + count, 0)),
      this.prisma.$queryRaw<{ day: string; amount: string; payments: bigint }[]>`
        SELECT to_char(date_trunc('day', succeeded_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
          sum(amount_minor)::text AS amount, count(*)::bigint AS payments
        FROM billing_payments WHERE is_test = false AND status IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED') AND succeeded_at >= ${month}
        GROUP BY 1 ORDER BY 1
      `
    ]);
    const [execution, seo] = await providerStates;
    const monthlyPlanValue = subscriptions.reduce((total, subscription) => {
      const price = subscription.planVersion.prices.find(item => item.currency === "RUB" && item.period === subscription.period);
      return total + (price ? subscription.period === "ANNUAL" ? price.amountMinor / 12n : price.amountMinor : 0n);
    }, 0n);
    return {
      generatedAt: now.toISOString(), users: { total: users, active7d: Number(activeUsers[0]?.count??0n), registered7d, unverified }, workspaces: { total: workspaces, withProjects, paying: subscriptions.length, readOnly }, projects,
      execution: execution.status === "fulfilled" ? execution.value : null, seo: seo.status === "fulfilled" ? seo.value : null,
      finance: { received30dMinor: money(received._sum.amountMinor ?? 0n), refunded30dMinor: money((refunded._sum.amountMinor ?? 0n) + (manualRefunded._sum.approvedAmountMinor ?? 0n)), receivedYearMinor: money(receivedYear._sum.amountMinor ?? 0n), monthlyPlanValueMinor: money(monthlyPlanValue), pendingRefunds, pendingReceipts, pendingPayments, usageReview, daily: daily.map(row => ({ date: row.day, amountMinor: money(BigInt(row.amount)), payments: Number(row.payments) })) },
      paymentProviders: this.billing.providers(), degraded: [...(execution.status === "rejected" ? ["EXECUTION" as const] : []), ...(seo.status === "rejected" ? ["SEO" as const] : [])]
    };
  }
}
function money(value: bigint): number { const number = Number(value); if (!Number.isSafeInteger(number)) throw new Error("Finance overview exceeds safe projection range"); return number; }
