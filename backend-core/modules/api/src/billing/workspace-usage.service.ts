import { Injectable } from "@nestjs/common";
import type { WorkspaceUsageMetric, WorkspaceUsageSummary } from "@seo-platform/contracts";
import type { TenantAuthorization } from "../authorization/authorization.types.js";
import { PrismaService } from "../database/prisma.service.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";
import { BillingService } from "./billing.service.js";
import { billingPlanFeatures } from "./billing-plan-features.js";
import { BillingEntitlementService } from "./billing-entitlement.service.js";

@Injectable()
export class WorkspaceUsageService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly entitlements: BillingEntitlementService,
    private readonly jobs: JobsClient,
    private readonly seo: SeoDataClient
  ) {}

  public async read(context: { tenant: TenantAuthorization; actorId: string; requestId: string }): Promise<WorkspaceUsageSummary> {
    const workspaceId = context.tenant.workspaceId;
    const [entitlement, subscription, balance, projects, seats, pendingInvites, execution] = await Promise.all([
      this.entitlements.snapshot(workspaceId),
      this.billing.subscription(workspaceId),
      this.billing.balance(workspaceId),
      this.prisma.project.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, status: true } }),
      this.prisma.workspaceMember.count({ where: { workspaceId, status: { in: ["ACTIVE", "SUSPENDED"] } } }),
      this.prisma.workspaceInvite.count({ where: { workspaceId, status: { in: ["SENT", "DELIVERED"] }, expiresAt: { gt: new Date() } } }),
      this.jobs.workspaceUsage(context).catch(() => undefined)
    ]);
    let keywordCount: number | null = 0;
    try {
      for (let offset = 0; offset < projects.length; offset += 50) {
        const batch = projects.slice(offset, offset + 50).map(project => project.id);
        const stats = await this.seo.adminProjectCounts(batch, context.actorId, context.requestId);
        keywordCount += stats.reduce((total, project) => total + project.keywordCount, 0);
      }
    } catch { keywordCount = null; }
    const historical = !entitlement && subscription
      ? await this.prisma.billingSubscription.findUnique({ where: { workspaceId }, include: { planVersion: true } })
      : null;
    const features = entitlement?.features ?? (historical ? billingPlanFeatures(historical.planVersion.features) : undefined);
    return {
      workspaceId, calculatedAt: new Date().toISOString(), balance,
      plan: features ? { code: entitlement?.planCode ?? subscription!.planCode, version: entitlement?.planVersion ?? subscription!.planVersion, name: subscription?.planName ?? "Бесплатный", features } : null,
      resources: {
        projects: metric(projects.filter(project => project.status !== "ARCHIVED").length, features?.projects),
        seats: metric(seats + pendingInvites, features?.seats),
        keywords: metric(keywordCount, features?.storedKeywords, true),
        concurrentJobs: metric(execution?.concurrentJobs ?? null, features?.concurrentJobs),
        automations: metric(execution?.automations ?? null, features?.scheduledAutomations),
        storageBytes: metric(execution ? safeSize(execution.storageBytes) : null, features?.storageBytes)
      },
      degraded: keywordCount === null || execution === undefined
    };
  }
}

function metric(used: number | null, limit: number | undefined, zeroIsUnlimited = false): WorkspaceUsageMetric {
  return { used, limit: limit === undefined || (zeroIsUnlimited && limit === 0) ? null : limit, available: used !== null };
}
function safeSize(value: string): number | null {
  const size = Number(value);
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}
