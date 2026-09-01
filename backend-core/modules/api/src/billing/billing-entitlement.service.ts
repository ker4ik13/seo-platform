import { Injectable } from "@nestjs/common";
import type {
  AutomationCapacityEntitlement,
  BillingPlanFeatures,
  JobCapacityEntitlement,
  RankEstimateQuota,
  SemanticCapacityEntitlement,
  StorageCapacityEntitlement
} from "@seo-platform/contracts";
import {
  Prisma,
  type BillingSubscriptionStatus
} from "../generated/prisma/client.js";
import { DomainError } from "../common/domain-error.js";
import { databaseClock } from "../database/database-clock.js";
import { PrismaService } from "../database/prisma.service.js";
import { billingPlanFeatures } from "./billing-plan-features.js";

const USABLE_SUBSCRIPTION_STATUSES = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE",
  "CANCELLING"
] as const satisfies readonly BillingSubscriptionStatus[];
const USABLE_SUBSCRIPTION_STATUS_SET =
  new Set<BillingSubscriptionStatus>(USABLE_SUBSCRIPTION_STATUSES);

export interface BillingEntitlementSnapshot {
  readonly planCode: string;
  readonly planVersion: number;
  readonly features: BillingPlanFeatures;
  readonly source: "SUBSCRIPTION" | "ONBOARDING";
}

export interface ProjectCapacitySnapshot {
  readonly used: number;
  readonly limit: number;
}

export type RankProviderEntitlement =
  | "ALLOWED"
  | "DENIED"
  | "NOT_AVAILABLE";

export interface RankProviderRunAccess {
  readonly entitlementStatus: RankProviderEntitlement;
  readonly quota: RankEstimateQuota;
}

export const MAX_PROJECT_CAPACITY_OVERRIDE = 100_000;

@Injectable()
export class BillingEntitlementService {
  public constructor(private readonly prisma: PrismaService) {}

  public async snapshot(
    workspaceId: string
  ): Promise<BillingEntitlementSnapshot | undefined> {
    return this.prisma.$transaction((transaction) =>
      this.snapshotInTransaction(transaction, workspaceId)
    );
  }

  public async semanticCapacity(
    workspaceId: string
  ): Promise<SemanticCapacityEntitlement> {
    return this.prisma.$transaction(async (transaction) => {
      const entitlement = await this.requiredEntitlement(
        transaction,
        workspaceId
      );
      return {
        planCode: entitlement.planCode,
        planVersion: entitlement.planVersion,
        storedKeywords: entitlement.features.storedKeywords,
        keywordsPerProject: entitlement.features.keywordsPerProject,
        foldersPerProject: entitlement.features.foldersPerProject,
        trackedContextPairs: entitlement.features.trackedContextPairs
      };
    });
  }

  public async jobCapacity(
    workspaceId: string
  ): Promise<JobCapacityEntitlement> {
    return this.prisma.$transaction(async (transaction) => {
      const entitlement = await this.requiredEntitlement(
        transaction,
        workspaceId
      );
      return {
        planCode: entitlement.planCode,
        planVersion: entitlement.planVersion,
        concurrentJobs: entitlement.features.concurrentJobs
      };
    });
  }

  public async storageCapacity(
    workspaceId: string
  ): Promise<StorageCapacityEntitlement> {
    return this.prisma.$transaction(async (transaction) => {
      const entitlement = await this.requiredEntitlement(
        transaction,
        workspaceId
      );
      return {
        planCode: entitlement.planCode,
        planVersion: entitlement.planVersion,
        storageBytes: entitlement.features.storageBytes
      };
    });
  }

  public async automationCapacity(
    workspaceId: string
  ): Promise<AutomationCapacityEntitlement> {
    return this.prisma.$transaction(async (transaction) => {
      const entitlement = await this.requiredEntitlement(
        transaction,
        workspaceId
      );
      return {
        planCode: entitlement.planCode,
        planVersion: entitlement.planVersion,
        scheduledAutomations:
          entitlement.features.scheduledAutomations
      };
    });
  }

  public async automationCapacityForRead(
    workspaceId: string
  ): Promise<AutomationCapacityEntitlement> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await this.snapshotInTransaction(
        transaction,
        workspaceId
      );
      if (current) return automationCapacity(current);

      const historical =
        await transaction.billingSubscription.findUnique({
          where: { workspaceId },
          include: {
            planVersion: {
              include: { plan: true }
            }
          }
        });
      if (!historical) {
        throw missingEntitlement(workspaceId);
      }
      return automationCapacity({
        planCode: historical.planVersion.plan.code,
        planVersion: historical.planVersion.version,
        features: billingPlanFeatures(
          historical.planVersion.features
        ),
        source: "SUBSCRIPTION"
      });
    });
  }

  public async assertCanCreateProject(
    transaction: Prisma.TransactionClient,
    workspaceId: string
  ): Promise<void> {
    await this.lockMutableWorkspace(transaction, workspaceId);
    const entitlement = await this.requiredEntitlement(
      transaction,
      workspaceId
    );
    const capacity = await this.projectCapacityInTransaction(
      transaction,
      workspaceId,
      entitlement
    );
    this.assertCapacity(
      "projects",
      capacity.used,
      capacity.limit,
      entitlement
    );
  }

  public async projectCapacity(
    workspaceId: string
  ): Promise<ProjectCapacitySnapshot> {
    return this.prisma.$transaction(async (transaction) => {
      const entitlement = await this.requiredEntitlement(
        transaction,
        workspaceId
      );
      return this.projectCapacityInTransaction(
        transaction,
        workspaceId,
        entitlement
      );
    });
  }

  private async projectCapacityInTransaction(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    entitlement: BillingEntitlementSnapshot
  ): Promise<ProjectCapacitySnapshot> {
    const [projects, incomingTransfers] = await Promise.all([
      transaction.project.count({
        where: {
          workspaceId,
          status: { notIn: ["DELETING", "DELETED"] }
        }
      }),
      transaction.projectTransferRequest.count({
        where: {
          destinationWorkspaceId: workspaceId,
          status: "PROCESSING"
        }
      })
    ]);
    const limit = await this.projectCapacityLimit(
      transaction,
      workspaceId,
      entitlement.features.projects
    );
    return { used: projects + incomingTransfers, limit };
  }

  public async projectCapacityLimit(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    planLimit: number
  ): Promise<number> {
    const override =
      await transaction.projectCapacityOverride.findUnique({
        where: { workspaceId },
        select: { projectLimit: true }
      });
    if (!override) return planLimit;
    if (
      !Number.isSafeInteger(override.projectLimit) ||
      override.projectLimit < 1 ||
      override.projectLimit > MAX_PROJECT_CAPACITY_OVERRIDE
    ) {
      throw new Error("Invalid project capacity override");
    }
    return override.projectLimit;
  }

  public async assertCanCreateInvite(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    roleCode: string
  ): Promise<void> {
    await this.lockMutableWorkspace(transaction, workspaceId);
    const entitlement = await this.requiredEntitlement(
      transaction,
      workspaceId
    );
    this.assertRoleAvailable(roleCode, entitlement);
    const now = await this.databaseNow(transaction);
    const [members, pendingInvites] = await Promise.all([
      transaction.workspaceMember.count({
        where: {
          workspaceId,
          status: { in: ["ACTIVE", "SUSPENDED"] }
        }
      }),
      transaction.workspaceInvite.count({
        where: {
          workspaceId,
          status: { in: ["SENT", "DELIVERED"] },
          expiresAt: { gt: now }
        }
      })
    ]);
    this.assertCapacity(
      "seats",
      members + pendingInvites,
      entitlement.features.seats,
      entitlement
    );
  }

  public async assertCanAcceptInvite(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    roleCode: string
  ): Promise<void> {
    await this.lockMutableWorkspace(transaction, workspaceId);
    const entitlement = await this.requiredEntitlement(
      transaction,
      workspaceId
    );
    this.assertRoleAvailable(roleCode, entitlement);
    const current = await transaction.workspaceMember.count({
      where: {
        workspaceId,
        status: { in: ["ACTIVE", "SUSPENDED"] }
      }
    });
    this.assertCapacity(
      "seats",
      current,
      entitlement.features.seats,
      entitlement
    );
  }

  public async rankProviderEntitlement(
    transaction: Prisma.TransactionClient,
    workspaceId: string
  ): Promise<RankProviderEntitlement> {
    const entitlement = await this.snapshotInTransaction(
      transaction,
      workspaceId
    );
    if (!entitlement) return "NOT_AVAILABLE";
    return entitlement.features.byok ? "ALLOWED" : "DENIED";
  }

  public async rankProviderAccess(
    workspaceId: string
  ): Promise<RankProviderEntitlement> {
    return this.prisma.$transaction((transaction) =>
      this.rankProviderEntitlement(transaction, workspaceId)
    );
  }

  public async rankProviderRunAccess(
    workspaceId: string
  ): Promise<RankProviderRunAccess> {
    return this.prisma.$transaction(async (transaction) => {
      const entitlementStatus = await this.rankProviderEntitlement(
        transaction,
        workspaceId
      );
      if (entitlementStatus !== "ALLOWED") {
        return {
          entitlementStatus,
          quota: { status: "NOT_AVAILABLE" }
        };
      }
      return {
        entitlementStatus,
        quota: { status: "UNLIMITED" }
      };
    });
  }

  private async snapshotInTransaction(
    transaction: Prisma.TransactionClient,
    workspaceId: string
  ): Promise<BillingEntitlementSnapshot | undefined> {
    const now = await this.databaseNow(transaction);
    const subscription =
      await transaction.billingSubscription.findUnique({
        where: { workspaceId },
        include: {
          planVersion: {
            include: { plan: true }
          }
        }
      });
    if (subscription) {
      if (!subscriptionIsUsable(subscription, now)) return undefined;
      return {
        planCode: subscription.planVersion.plan.code,
        planVersion: subscription.planVersion.version,
        features: billingPlanFeatures(subscription.planVersion.features),
        source: "SUBSCRIPTION"
      };
    }

    const onboardingPlan =
      await transaction.billingPlanVersion.findFirst({
        where: {
          status: "PUBLISHED",
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          plan: { code: "TRIAL", status: "ACTIVE" }
        },
        include: { plan: true },
        orderBy: [{ version: "desc" }, { id: "desc" }]
      });
    if (!onboardingPlan) return undefined;
    return {
      planCode: onboardingPlan.plan.code,
      planVersion: onboardingPlan.version,
      features: billingPlanFeatures(onboardingPlan.features),
      source: "ONBOARDING"
    };
  }

  private async requiredEntitlement(
    transaction: Prisma.TransactionClient,
    workspaceId: string
  ): Promise<BillingEntitlementSnapshot> {
    const entitlement = await this.snapshotInTransaction(
      transaction,
      workspaceId
    );
    if (entitlement) return entitlement;
    throw missingEntitlement(workspaceId);
  }

  private async lockMutableWorkspace(
    transaction: Prisma.TransactionClient,
    workspaceId: string
  ): Promise<void> {
    const rows = await transaction.$queryRaw<
      readonly { readonly status: string }[]
    >`
      SELECT "status"::text AS "status"
      FROM "workspaces"
      WHERE "id" = ${workspaceId}::uuid
      FOR UPDATE
    `;
    const workspace = rows[0];
    if (!workspace) {
      throw new DomainError({
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Workspace not found"
      });
    }
    if (workspace.status !== "ACTIVE") {
      throw new DomainError({
        statusCode: 402,
        code: "PAYMENT_REQUIRED",
        message: "Workspace is read-only; plan mutations are unavailable",
        details: { workspaceId, workspaceStatus: workspace.status }
      });
    }
  }

  private assertCapacity(
    resource: "projects" | "seats",
    current: number,
    limit: number,
    entitlement: BillingEntitlementSnapshot
  ): void {
    if (current < limit) return;
    throw new DomainError({
      statusCode: 409,
      code: "QUOTA_EXCEEDED",
      message: `The ${resource} limit for the current plan has been reached`,
      details: {
        resource,
        current,
        limit,
        planCode: entitlement.planCode,
        planVersion: entitlement.planVersion
      }
    });
  }

  private assertRoleAvailable(
    roleCode: string,
    entitlement: BillingEntitlementSnapshot
  ): void {
    if (roleCode !== "CLIENT" || entitlement.features.clientRole) return;
    throw new DomainError({
      statusCode: 403,
      code: "FEATURE_NOT_AVAILABLE",
      message: "The CLIENT role is not available on the current plan",
      details: {
        feature: "clientRole",
        planCode: entitlement.planCode,
        planVersion: entitlement.planVersion
      }
    });
  }

  private async databaseNow(
    transaction: Prisma.TransactionClient
  ): Promise<Date> {
    return databaseClock(transaction);
  }
}

function automationCapacity(
  entitlement: BillingEntitlementSnapshot
): AutomationCapacityEntitlement {
  return {
    planCode: entitlement.planCode,
    planVersion: entitlement.planVersion,
    scheduledAutomations: entitlement.features.scheduledAutomations
  };
}

function missingEntitlement(workspaceId: string): DomainError {
  return new DomainError({
    statusCode: 402,
    code: "PAYMENT_REQUIRED",
    message: "An active subscription is required for this operation",
    details: { workspaceId }
  });
}

function subscriptionIsUsable(
  subscription: {
    readonly status: BillingSubscriptionStatus;
    readonly currentPeriodEnd: Date;
    readonly graceEnd: Date | null;
  },
  now: Date
): boolean {
  if (!USABLE_SUBSCRIPTION_STATUS_SET.has(subscription.status)) {
    return false;
  }
  if (
    (subscription.status === "PAST_DUE" ||
      subscription.status === "GRACE") &&
    subscription.graceEnd
  ) {
    return subscription.graceEnd > now;
  }
  return subscription.currentPeriodEnd > now;
}
