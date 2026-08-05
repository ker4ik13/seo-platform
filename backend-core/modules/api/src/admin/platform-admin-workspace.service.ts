import { Injectable } from "@nestjs/common";
import type {
  AdminBillingPlanSummary,
  AdminWorkspaceSearchResult,
  AdminWorkspaceSubscriptionGrantSummary,
  AdminWorkspaceSummary,
  GrantAdminWorkspaceSubscriptionInput
} from "@seo-platform/contracts";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import { AuditService } from "../audit/audit.service.js";
import {
  BillingService,
  billingSubscriptionSummary
} from "../billing/billing.service.js";
import {
  DomainError,
  isUniqueConstraintError
} from "../common/domain-error.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { RequestContext } from "../identity/identity.types.js";
import type {
  AdminSubscriptionPrecondition
} from "./platform-admin-workspace-input.js";

const WORKSPACE_SEARCH_LIMIT = 50;
const SUBSCRIPTION_GRANT_ACTION =
  "platform_admin.workspace_subscription.granted";
const SUBSCRIPTION_INCLUDE = {
  planVersion: { include: { plan: true } },
  defaultPaymentMethod: { select: { status: true } }
} as const;

@Injectable()
export class PlatformAdminWorkspaceService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly audit: AuditService
  ) {}

  public plans(now = new Date()): Promise<readonly AdminBillingPlanSummary[]> {
    return this.billing.plans(now);
  }

  public async searchWorkspaces(
    query: string
  ): Promise<AdminWorkspaceSearchResult> {
    const ownerIds = query
      ? await this.matchingOwnerIds(query)
      : [];
    const idQuery = UUID_PATTERN.test(query) ? query : undefined;
    const workspaces = await this.prisma.workspace.findMany({
      where: query
        ? {
            OR: [
              ...(idQuery ? [{ id: idQuery }] : []),
              { name: { contains: query, mode: "insensitive" } },
              { slug: { contains: query, mode: "insensitive" } },
              ...(ownerIds.length > 0
                ? [{ ownerUserId: { in: ownerIds } }]
                : [])
            ]
          }
        : {},
      include: {
        _count: { select: { members: true, projects: true } },
        billingSubscription: { include: SUBSCRIPTION_INCLUDE }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: WORKSPACE_SEARCH_LIMIT + 1
    });
    const page = workspaces.slice(0, WORKSPACE_SEARCH_LIMIT);
    const owners = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(page.map((item) => item.ownerUserId))] } },
      select: {
        id: true,
        emailDisplay: true,
        displayName: true,
        status: true
      }
    });
    const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
    return {
      data: page.map((workspace) => {
        const owner = ownerById.get(workspace.ownerUserId);
        return {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          status: workspace.status,
          owner: owner
            ? {
                userId: owner.id,
                email: owner.emailDisplay,
                displayName: owner.displayName,
                status: owner.status
              }
            : {
                userId: workspace.ownerUserId,
                email: "",
                displayName: "Владелец не найден",
                status: "DELETED"
              },
          memberCount: workspace._count.members,
          projectCount: workspace._count.projects,
          subscription: workspace.billingSubscription
            ? billingSubscriptionSummary(workspace.billingSubscription)
            : null,
          createdAt: workspace.createdAt.toISOString(),
          version: workspace.version
        } satisfies AdminWorkspaceSummary;
      }),
      truncated: workspaces.length > WORKSPACE_SEARCH_LIMIT
    };
  }

  public async grantSubscription(
    workspaceId: string,
    input: GrantAdminWorkspaceSubscriptionInput,
    precondition: AdminSubscriptionPrecondition,
    actorId: string,
    idempotencyKey: string,
    context: RequestContext,
    now = new Date()
  ): Promise<AdminWorkspaceSubscriptionGrantSummary> {
    const requestHash = Buffer.from(
      canonicalJsonSha256("platform-admin-subscription-grant@1", {
        workspaceId,
        input,
        precondition
      }),
      "hex"
    );
    const replay = await this.commandReceipt(actorId, idempotencyKey);
    if (replay) return replaySummary(replay, requestHash);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const transactionReplay = await this.commandReceipt(
          actorId,
          idempotencyKey,
          transaction
        );
        if (transactionReplay) {
          return replaySummary(transactionReplay, requestHash);
        }

        const workspace = await transaction.workspace.findUnique({
          where: { id: workspaceId },
          select: { id: true, status: true }
        });
        if (!workspace) throw notFound();
        if (workspace.status !== "ACTIVE") {
          throw stateConflict(
            "A subscription can only be granted to an active workspace"
          );
        }
        const pendingCheckout = await transaction.billingOrder.findFirst({
          where: {
            workspaceId,
            kind: "SUBSCRIPTION",
            status: { in: ["PENDING", "PROVIDER_PENDING"] }
          },
          select: { id: true }
        });
        if (pendingCheckout) {
          throw stateConflict(
            "Resolve the pending subscription checkout before applying a manual grant"
          );
        }

        const planVersion = await transaction.billingPlanVersion.findFirst({
          where: {
            version: input.planVersion,
            status: "PUBLISHED",
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
            plan: { code: input.planCode, status: "ACTIVE" }
          },
          include: { plan: true }
        });
        if (!planVersion) {
          throw stateConflict("The selected billing plan version is unavailable");
        }

        const current = await transaction.billingSubscription.findUnique({
          where: { workspaceId },
          include: SUBSCRIPTION_INCLUDE
        });
        assertPrecondition(current?.version, precondition);

        const periodEnd = new Date(input.currentPeriodEnd);
        const subscription = current
          ? await updateSubscription(
              transaction,
              current.id,
              current.version,
              planVersion.id,
              now,
              periodEnd
            )
          : await transaction.billingSubscription.create({
              data: {
                workspaceId,
                planVersionId: planVersion.id,
                status: "ACTIVE",
                period: "MONTHLY",
                currency: "RUB",
                startedAt: now,
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd
              },
              include: SUBSCRIPTION_INCLUDE
            });
        const summary = grantSummary(subscription);
        await this.audit.record(
          {
            actorId,
            workspaceId,
            action: SUBSCRIPTION_GRANT_ACTION,
            resourceType: "billing_subscription",
            resourceId: subscription.id,
            reason: input.reason,
            redactedChanges: {
              planCode: {
                from: current?.planVersion.plan.code ?? null,
                to: summary.planCode
              },
              planVersion: {
                from: current?.planVersion.version ?? null,
                to: summary.planVersion
              },
              status: { from: current?.status ?? null, to: "ACTIVE" },
              currentPeriodEnd: {
                from: current?.currentPeriodEnd.toISOString() ?? null,
                to: summary.currentPeriodEnd
              },
              paymentBindingCleared: Boolean(
                current?.provider ||
                  current?.externalSubscriptionId ||
                  current?.defaultPaymentMethodId
              )
            },
            requestId: context.requestId
          },
          transaction
        );
        await transaction.platformAdminCommandReceipt.create({
          data: {
            actorId,
            action: SUBSCRIPTION_GRANT_ACTION,
            idempotencyKey,
            requestHash,
            responseSnapshot: summary as unknown as Prisma.InputJsonValue,
            workspaceId,
            resourceType: "billing_subscription",
            resourceId: subscription.id
          }
        });
        return summary;
      });
    } catch (error) {
      const concurrent = await this.commandReceipt(actorId, idempotencyKey);
      if (concurrent) return replaySummary(concurrent, requestHash);
      if (isUniqueConstraintError(error)) {
        const subscription =
          await this.prisma.billingSubscription.findUnique({
            where: { workspaceId },
            select: { version: true }
          });
        if (subscription) throw versionConflict(subscription.version);
      }
      throw error;
    }
  }

  private async matchingOwnerIds(query: string): Promise<string[]> {
    const normalizedEmail = query.toLowerCase();
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { emailNormalized: { contains: normalizedEmail } },
          { emailDisplay: { contains: query, mode: "insensitive" } },
          { displayName: { contains: query, mode: "insensitive" } }
        ]
      },
      select: { id: true },
      take: WORKSPACE_SEARCH_LIMIT + 1
    });
    return users.map((user) => user.id);
  }

  private commandReceipt(
    actorId: string,
    idempotencyKey: string,
    client: Pick<Prisma.TransactionClient, "platformAdminCommandReceipt"> =
      this.prisma
  ) {
    return client.platformAdminCommandReceipt.findUnique({
      where: {
        actorId_action_idempotencyKey: {
          actorId,
          action: SUBSCRIPTION_GRANT_ACTION,
          idempotencyKey
        }
      }
    });
  }
}

async function updateSubscription(
  transaction: Prisma.TransactionClient,
  id: string,
  version: number,
  planVersionId: string,
  currentPeriodStart: Date,
  currentPeriodEnd: Date
) {
  const changed = await transaction.billingSubscription.updateMany({
    where: { id, version },
    data: {
      planVersionId,
      status: "ACTIVE",
      period: "MONTHLY",
      currency: "RUB",
      currentPeriodStart,
      currentPeriodEnd,
      trialEnd: null,
      graceEnd: null,
      cancelAtPeriodEnd: false,
      provider: null,
      externalSubscriptionId: null,
      defaultPaymentMethodId: null,
      version: { increment: 1 }
    }
  });
  if (changed.count !== 1) {
    const latest = await transaction.billingSubscription.findUnique({
      where: { id },
      select: { version: true }
    });
    throw versionConflict(latest?.version ?? version);
  }
  return transaction.billingSubscription.findUniqueOrThrow({
    where: { id },
    include: SUBSCRIPTION_INCLUDE
  });
}

function assertPrecondition(
  currentVersion: number | undefined,
  precondition: AdminSubscriptionPrecondition
): void {
  if (currentVersion === undefined) {
    if (!precondition.createOnly) throw versionConflict(0);
    return;
  }
  if (
    precondition.createOnly ||
    precondition.expectedVersion !== currentVersion
  ) {
    throw versionConflict(currentVersion);
  }
}

function grantSummary(
  subscription: Prisma.BillingSubscriptionGetPayload<{
    include: typeof SUBSCRIPTION_INCLUDE;
  }>
): AdminWorkspaceSubscriptionGrantSummary {
  return {
    workspaceId: subscription.workspaceId,
    subscriptionId: subscription.id,
    planCode: subscription.planVersion.plan.code,
    planVersion: subscription.planVersion.version,
    planName: subscription.planVersion.plan.nameRu,
    status: "ACTIVE",
    currentPeriodStart: subscription.currentPeriodStart.toISOString(),
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    version: subscription.version
  };
}

function replaySummary(
  receipt: {
    readonly requestHash: Uint8Array;
    readonly responseSnapshot: Prisma.JsonValue;
  },
  expectedHash: Buffer
): AdminWorkspaceSubscriptionGrantSummary {
  if (!Buffer.from(receipt.requestHash).equals(expectedHash)) {
    throw new DomainError({
      statusCode: 409,
      code: "IDEMPOTENCY_CONFLICT",
      message: "Idempotency key was already used with another request"
    });
  }
  const value = receipt.responseSnapshot;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored platform admin command receipt is invalid");
  }
  const record = value as Record<string, Prisma.JsonValue>;
  for (const field of [
    "workspaceId",
    "subscriptionId",
    "planCode",
    "planName",
    "status",
    "currentPeriodStart",
    "currentPeriodEnd"
  ]) {
    if (typeof record[field] !== "string") {
      throw new Error("Stored platform admin command receipt is invalid");
    }
  }
  if (
    record.status !== "ACTIVE" ||
    !Number.isSafeInteger(record.planVersion) ||
    !Number.isSafeInteger(record.version)
  ) {
    throw new Error("Stored platform admin command receipt is invalid");
  }
  return record as unknown as AdminWorkspaceSubscriptionGrantSummary;
}

function notFound(): DomainError {
  return new DomainError({
    statusCode: 404,
    code: "NOT_FOUND",
    message: "Workspace not found"
  });
}

function stateConflict(message: string): DomainError {
  return new DomainError({
    statusCode: 409,
    code: "RESOURCE_STATE_CONFLICT",
    message
  });
}

function versionConflict(currentVersion: number): DomainError {
  return new DomainError({
    statusCode: 409,
    code: "VERSION_CONFLICT",
    message: "The subscription was changed by another request",
    details: { currentVersion }
  });
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
