import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
import {
  domainEventTypes,
  type InternalProjectWorkspaceTransferInput,
  type ProjectTransferRequestSummary
} from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import { hasSystemPermission } from "../authorization/permissions.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import {
  DomainError,
  isUniqueConstraintError
} from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import { databaseClock } from "../database/database-clock.js";
import { PrismaService } from "../database/prisma.service.js";
import type {
  Prisma,
  ProjectTransferRequest
} from "../generated/prisma/client.js";
import type { RequestContext } from "../identity/identity.types.js";
import { JobsClient } from "../jobs/jobs.client.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { SeoDataClient } from "../seo-data/seo-data.client.js";

const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const RECONCILE_INTERVAL_MS = 5_000;
const RECONCILE_BATCH_SIZE = 5;
const RECONCILE_LEASE_MS = 30_000;
const MAX_RETRY_MS = 5 * 60_000;

const transferInclude = {
  project: true,
  sourceWorkspace: true,
  destinationWorkspace: true
} as const satisfies Prisma.ProjectTransferRequestInclude;

type TransferWithProject = Prisma.ProjectTransferRequestGetPayload<{
  include: typeof transferInclude;
}>;

@Injectable()
export class ProjectTransferService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectTransferService.name);
  private timer?: ReturnType<typeof setInterval>;
  private tickRunning = false;

  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly entitlements: BillingEntitlementService,
    private readonly jobs: JobsClient,
    private readonly seoData: SeoDataClient
  ) {}

  public onModuleInit(): void {
    this.timer = setInterval(
      () => void this.tick().catch(() => this.logTickFailure()),
      RECONCILE_INTERVAL_MS
    );
    this.timer.unref?.();
    void this.tick().catch(() => this.logTickFailure());
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private logTickFailure(): void {
    this.logger.error("Project transfer reconciler tick failed");
  }

  public async request(
    actorUserId: string,
    projectId: string,
    targetMemberId: string,
    context: RequestContext
  ): Promise<ProjectTransferRequestSummary> {
    const actorId = assertUuid(actorUserId, "actorUserId");
    const canonicalProjectId = assertUuid(projectId, "projectId");
    const memberId = assertUuid(targetMemberId, "targetMemberId");
    await this.expirePending({ projectId: canonicalProjectId });

    try {
      const transfer = await this.prisma.$transaction(async (transaction) => {
        const now = await databaseClock(transaction);
        const project = await transaction.project.findUnique({
          where: { id: canonicalProjectId },
          include: { workspace: true }
        });
        if (!project || ["DELETING", "DELETED"].includes(project.status)) {
          throw notFound();
        }
        if (project.workspace.status !== "ACTIVE") {
          throw stateConflict("Project transfer requires an active workspace");
        }
        if (project.ownerUserId !== actorId) {
          throw forbidden("Only the current project owner can transfer it");
        }
        const target = await transaction.workspaceMember.findUnique({
          where: { id: memberId },
          include: { user: true }
        });
        if (
          !target ||
          target.workspaceId !== project.workspaceId ||
          target.status !== "ACTIVE" ||
          target.user.status !== "ACTIVE"
        ) {
          throw validation("targetMemberId", "Select an active workspace member");
        }
        if (target.userId === actorId) {
          throw validation("targetMemberId", "Select another workspace member");
        }
        const created = await transaction.projectTransferRequest.create({
          data: {
            workspaceId: project.workspaceId,
            projectId: project.id,
            fromUserId: project.ownerUserId,
            toUserId: target.userId,
            requestedBy: actorId,
            expiresAt: new Date(now.getTime() + TRANSFER_TTL_MS)
          }
        });
        await this.audit.record(
          {
            actorId,
            workspaceId: project.workspaceId,
            projectId: project.id,
            action: "project.transfer.requested",
            resourceType: "projectTransferRequest",
            resourceId: created.id,
            requestId: context.requestId
          },
          transaction
        );
        await this.outbox.event(transaction, {
          eventType: domainEventTypes.projectTransferRequested,
          aggregateType: "projectTransferRequest",
          aggregateId: created.id,
          aggregateVersion: 1,
          workspaceId: project.workspaceId,
          projectId: project.id,
          payload: {
            transferId: created.id,
            workspaceId: project.workspaceId,
            projectId: project.id,
            fromUserId: project.ownerUserId,
            toUserId: target.userId,
            expiresAt: created.expiresAt.toISOString()
          },
          requestId: context.requestId
        });
        return created;
      });
      return this.summary(transfer);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw stateConflict("An active project transfer already exists");
      }
      throw error;
    }
  }

  public async current(
    actorUserId: string,
    projectId: string
  ): Promise<ProjectTransferRequestSummary | null> {
    const actorId = assertUuid(actorUserId, "actorUserId");
    const canonicalProjectId = assertUuid(projectId, "projectId");
    await this.expirePending({ projectId: canonicalProjectId });
    const project = await this.prisma.project.findUnique({
      where: { id: canonicalProjectId },
      select: { ownerUserId: true }
    });
    if (!project || project.ownerUserId !== actorId) {
      throw forbidden("Only the current project owner can view the transfer");
    }
    const transfer = await this.prisma.projectTransferRequest.findFirst({
      where: {
        projectId: canonicalProjectId,
        status: { in: ["PENDING", "PROCESSING"] }
      },
      orderBy: { createdAt: "desc" }
    });
    return transfer ? this.summary(transfer) : null;
  }

  public async incoming(
    userId: string
  ): Promise<readonly ProjectTransferRequestSummary[]> {
    const canonicalUserId = assertUuid(userId, "userId");
    await this.expirePending({ toUserId: canonicalUserId });
    const transfers: readonly TransferWithProject[] =
      await this.prisma.projectTransferRequest.findMany({
        where: {
          toUserId: canonicalUserId,
          status: { in: ["PENDING", "PROCESSING"] },
          project: { status: { notIn: ["DELETING", "DELETED"] } },
          sourceWorkspace: { status: { notIn: ["DELETING", "DELETED"] } }
        },
        include: transferInclude,
        orderBy: { createdAt: "desc" },
        take: 50
      });
    return this.summaries(transfers);
  }

  public async accept(
    userId: string,
    transferId: string,
    destinationWorkspaceId: string,
    context: RequestContext
  ): Promise<ProjectTransferRequestSummary> {
    const actorId = assertUuid(userId, "userId");
    const canonicalTransferId = assertUuid(transferId, "transferId");
    const destinationId = assertUuid(
      destinationWorkspaceId,
      "destinationWorkspaceId"
    );
    await this.expirePending({ id: canonicalTransferId });

    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.projectTransferRequest.findUnique({
        where: { id: canonicalTransferId },
        include: { project: true }
      });
      if (!current || !["PENDING", "PROCESSING"].includes(current.status)) {
        throw notFound();
      }
      if (current.toUserId !== actorId) {
        throw forbidden("The project transfer belongs to another account");
      }
      if (current.status === "PROCESSING") {
        if (current.destinationWorkspaceId !== destinationId) {
          throw stateConflict("Project transfer is already moving to another workspace");
        }
        return;
      }
      if (destinationId === current.workspaceId) {
        throw validation(
          "destinationWorkspaceId",
          "Select one of your other workspaces"
        );
      }
      if (current.project.ownerUserId !== current.fromUserId) {
        throw stateConflict("Project ownership changed before this decision");
      }
      if (["DELETING", "DELETED"].includes(current.project.status)) {
        throw stateConflict("Project can no longer be transferred");
      }

      const [sourceMember, destinationMember] = await Promise.all([
        transaction.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: current.workspaceId,
              userId: actorId
            }
          }
        }),
        transaction.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: destinationId,
              userId: actorId
            }
          },
          include: { workspace: true }
        })
      ]);
      if (!sourceMember || sourceMember.status !== "ACTIVE") {
        throw stateConflict("An active source workspace membership is required");
      }
      if (
        !destinationMember ||
        destinationMember.status !== "ACTIVE" ||
        destinationMember.workspace.status !== "ACTIVE" ||
        !hasSystemPermission(destinationMember.roleCode, "project.create")
      ) {
        throw validation(
          "destinationWorkspaceId",
          "Select an active workspace where you can create projects"
        );
      }

      await this.entitlements.assertCanCreateProject(transaction, destinationId);
      const now = await databaseClock(transaction);
      const changed = await transaction.projectTransferRequest.updateMany({
        where: {
          id: current.id,
          status: "PENDING",
          expiresAt: { gt: now }
        },
        data: {
          status: "PROCESSING",
          destinationWorkspaceId: destinationId,
          sourceProjectStatus: current.project.status,
          processingStartedAt: now,
          nextAttemptAt: now,
          lastErrorCode: null,
          reconcileVersion: { increment: 1 }
        }
      });
      if (changed.count !== 1) {
        throw stateConflict("Project transfer is no longer pending");
      }
      const projectChanged = await transaction.project.updateMany({
        where: {
          id: current.projectId,
          workspaceId: current.workspaceId,
          ownerUserId: current.fromUserId,
          status: current.project.status
        },
        data: {
          status: "ARCHIVED",
          version: { increment: 1 },
          ...(current.project.status === "ARCHIVED" ? {} : { archivedAt: now })
        }
      });
      if (projectChanged.count !== 1) {
        throw stateConflict("Project changed before transfer processing started");
      }
      await this.audit.record(
        {
          actorId,
          workspaceId: current.workspaceId,
          projectId: current.projectId,
          action: "project.transfer.processing",
          resourceType: "projectTransferRequest",
          resourceId: current.id,
          requestId: context.requestId
        },
        transaction
      );
    });

    await this.reconcileTransfer(canonicalTransferId, context.requestId);
    return this.summaryById(canonicalTransferId);
  }

  public async decline(
    userId: string,
    transferId: string,
    context: RequestContext
  ): Promise<ProjectTransferRequestSummary> {
    const actorId = assertUuid(userId, "userId");
    const canonicalTransferId = assertUuid(transferId, "transferId");
    await this.expirePending({ id: canonicalTransferId });
    const transfer = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.projectTransferRequest.findUnique({
        where: { id: canonicalTransferId }
      });
      if (!current || current.status !== "PENDING") throw notFound();
      if (current.toUserId !== actorId) {
        throw forbidden("The project transfer belongs to another account");
      }
      const now = await databaseClock(transaction);
      const changed = await transaction.projectTransferRequest.updateMany({
        where: { id: current.id, status: "PENDING", expiresAt: { gt: now } },
        data: { status: "DECLINED", declinedAt: now }
      });
      if (changed.count !== 1) {
        throw stateConflict("Project transfer is no longer pending");
      }
      await this.recordDecision(
        transaction,
        current,
        actorId,
        "DECLINED",
        context.requestId
      );
      return transaction.projectTransferRequest.findUniqueOrThrow({
        where: { id: current.id }
      });
    });
    return this.summary(transfer);
  }

  public async cancel(
    actorUserId: string,
    projectId: string,
    context: RequestContext
  ): Promise<ProjectTransferRequestSummary> {
    const actorId = assertUuid(actorUserId, "actorUserId");
    const canonicalProjectId = assertUuid(projectId, "projectId");
    await this.expirePending({ projectId: canonicalProjectId });
    const transfer = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.projectTransferRequest.findFirst({
        where: { projectId: canonicalProjectId, status: "PENDING" },
        include: { project: true }
      });
      if (!current) throw notFound();
      if (
        current.fromUserId !== actorId ||
        current.project.ownerUserId !== actorId
      ) {
        throw forbidden("Only the current project owner can cancel the transfer");
      }
      const now = await databaseClock(transaction);
      const changed = await transaction.projectTransferRequest.updateMany({
        where: { id: current.id, status: "PENDING" },
        data: { status: "CANCELLED", cancelledAt: now }
      });
      if (changed.count !== 1) {
        throw stateConflict("Project transfer changed concurrently");
      }
      await this.audit.record(
        {
          actorId,
          workspaceId: current.workspaceId,
          projectId: current.projectId,
          action: "project.transfer.cancelled",
          resourceType: "projectTransferRequest",
          resourceId: current.id,
          requestId: context.requestId
        },
        transaction
      );
      await this.outbox.event(transaction, {
        eventType: domainEventTypes.projectTransferCancelled,
        aggregateType: "projectTransferRequest",
        aggregateId: current.id,
        aggregateVersion: 2,
        workspaceId: current.workspaceId,
        projectId: current.projectId,
        payload: {
          transferId: current.id,
          workspaceId: current.workspaceId,
          projectId: current.projectId,
          fromUserId: current.fromUserId,
          toUserId: current.toUserId
        },
        requestId: context.requestId
      });
      return transaction.projectTransferRequest.findUniqueOrThrow({
        where: { id: current.id }
      });
    });
    return this.summary(transfer);
  }

  private async tick(): Promise<void> {
    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      const due = await this.prisma.projectTransferRequest.findMany({
        where: {
          status: "PROCESSING",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }]
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: RECONCILE_BATCH_SIZE
      });
      for (const { id } of due) {
        await this.reconcileTransfer(id, `project-transfer-reconcile:${id}`);
      }
    } finally {
      this.tickRunning = false;
    }
  }

  private async reconcileTransfer(
    transferId: string,
    requestId: string
  ): Promise<void> {
    const claimed = await this.claimTransfer(transferId);
    if (!claimed || !claimed.destinationWorkspaceId) return;
    const command: InternalProjectWorkspaceTransferInput = {
      workspaceId: claimed.workspaceId,
      projectId: claimed.projectId,
      actorId: claimed.toUserId,
      destinationWorkspaceId: claimed.destinationWorkspaceId
    };
    try {
      await this.jobs.resetProjectForWorkspaceTransfer(command, requestId);
      await this.seoData.transferProjectWorkspace(command, requestId);
      await this.finalizeTransfer(claimed.id, requestId);
    } catch (error) {
      await this.recordReconcileFailure(
        claimed.id,
        claimed.reconcileVersion,
        claimed.attemptCount,
        reconcileErrorCode(error)
      );
    }
  }

  private async claimTransfer(
    transferId: string
  ): Promise<TransferWithProject | null> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.projectTransferRequest.findUnique({
        where: { id: transferId },
        include: transferInclude
      });
      const now = await databaseClock(transaction);
      if (
        !current ||
        current.status !== "PROCESSING" ||
        (current.nextAttemptAt && current.nextAttemptAt > now)
      ) {
        return null;
      }
      const changed = await transaction.projectTransferRequest.updateMany({
        where: {
          id: current.id,
          status: "PROCESSING",
          reconcileVersion: current.reconcileVersion
        },
        data: {
          attemptCount: { increment: 1 },
          reconcileVersion: { increment: 1 },
          nextAttemptAt: new Date(now.getTime() + RECONCILE_LEASE_MS),
          lastErrorCode: null
        }
      });
      if (changed.count !== 1) return null;
      return transaction.projectTransferRequest.findUniqueOrThrow({
        where: { id: current.id },
        include: transferInclude
      });
    });
  }

  private async recordReconcileFailure(
    transferId: string,
    reconcileVersion: number,
    attemptCount: number,
    errorCode: string
  ): Promise<void> {
    const delay = Math.min(
      MAX_RETRY_MS,
      RECONCILE_INTERVAL_MS * 2 ** Math.min(Math.max(0, attemptCount - 1), 6)
    );
    await this.prisma.projectTransferRequest.updateMany({
      where: {
        id: transferId,
        status: "PROCESSING",
        reconcileVersion
      },
      data: {
        lastErrorCode: errorCode,
        nextAttemptAt: new Date(Date.now() + delay)
      }
    });
  }

  private async finalizeTransfer(
    transferId: string,
    requestId: string
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.projectTransferRequest.findUnique({
        where: { id: transferId },
        include: transferInclude
      });
      if (!current || current.status === "ACCEPTED") return;
      if (
        current.status !== "PROCESSING" ||
        !current.destinationWorkspaceId ||
        !current.destinationWorkspace ||
        !current.sourceProjectStatus
      ) {
        throw stateConflict("Project transfer cannot be finalized");
      }
      const member = await transaction.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: current.destinationWorkspaceId,
            userId: current.toUserId
          }
        }
      });
      if (
        !member ||
        member.status !== "ACTIVE" ||
        current.destinationWorkspace.status !== "ACTIVE" ||
        !hasSystemPermission(member.roleCode, "project.create")
      ) {
        throw stateConflict("Destination workspace access changed during transfer");
      }

      const now = await databaseClock(transaction);
      const slug = await availableProjectSlug(
        transaction,
        current.destinationWorkspaceId,
        current.project.slug,
        current.project.id
      );
      await transaction.projectMemberAccess.deleteMany({
        where: { projectId: current.projectId }
      });
      const projectChanged = await transaction.project.updateMany({
        where: {
          id: current.projectId,
          workspaceId: current.workspaceId,
          ownerUserId: current.fromUserId,
          status: "ARCHIVED"
        },
        data: {
          workspaceId: current.destinationWorkspaceId,
          ownerUserId: current.toUserId,
          slug,
          status: current.sourceProjectStatus,
          archivedAt:
            current.sourceProjectStatus === "ARCHIVED"
              ? current.project.archivedAt
              : null,
          version: { increment: 1 }
        }
      });
      if (projectChanged.count !== 1) {
        throw stateConflict("Project changed while transfer was processing");
      }
      await transaction.projectMemberAccess.create({
        data: {
          projectId: current.projectId,
          memberId: member.id,
          level: "MANAGER"
        }
      });
      const transferChanged = await transaction.projectTransferRequest.updateMany({
        where: { id: current.id, status: "PROCESSING" },
        data: {
          status: "ACCEPTED",
          acceptedAt: now,
          nextAttemptAt: null,
          lastErrorCode: null,
          reconcileVersion: { increment: 1 }
        }
      });
      if (transferChanged.count !== 1) {
        throw stateConflict("Project transfer changed while finalizing");
      }
      await this.audit.record(
        {
          actorId: current.toUserId,
          workspaceId: current.destinationWorkspaceId,
          projectId: current.projectId,
          action: "project.ownership.transferred",
          resourceType: "projectTransferRequest",
          resourceId: current.id,
          requestId
        },
        transaction
      );
      await this.outbox.event(transaction, {
        eventType: domainEventTypes.projectOwnershipTransferred,
        aggregateType: "projectTransferRequest",
        aggregateId: current.id,
        aggregateVersion: 2,
        workspaceId: current.destinationWorkspaceId,
        projectId: current.projectId,
        payload: {
          transferId: current.id,
          workspaceId: current.destinationWorkspaceId,
          sourceWorkspaceId: current.workspaceId,
          destinationWorkspaceId: current.destinationWorkspaceId,
          projectId: current.projectId,
          fromUserId: current.fromUserId,
          toUserId: current.toUserId,
          decision: "ACCEPTED"
        },
        requestId
      });
    });
  }

  private async recordDecision(
    transaction: Prisma.TransactionClient,
    current: ProjectTransferRequest,
    actorId: string,
    decision: "DECLINED",
    requestId: string
  ): Promise<void> {
    await this.audit.record(
      {
        actorId,
        workspaceId: current.workspaceId,
        projectId: current.projectId,
        action: "project.transfer.declined",
        resourceType: "projectTransferRequest",
        resourceId: current.id,
        requestId
      },
      transaction
    );
    await this.outbox.event(transaction, {
      eventType: domainEventTypes.projectTransferDeclined,
      aggregateType: "projectTransferRequest",
      aggregateId: current.id,
      aggregateVersion: 2,
      workspaceId: current.workspaceId,
      projectId: current.projectId,
      payload: {
        transferId: current.id,
        workspaceId: current.workspaceId,
        projectId: current.projectId,
        fromUserId: current.fromUserId,
        toUserId: current.toUserId,
        decision
      },
      requestId
    });
  }

  private async expirePending(
    selector: Readonly<{ id?: string; projectId?: string; toUserId?: string }>
  ): Promise<void> {
    await this.prisma.projectTransferRequest.updateMany({
      where: {
        ...selector,
        status: "PENDING",
        expiresAt: { lte: new Date() }
      },
      data: { status: "EXPIRED" }
    });
  }

  private async summary(
    record: Pick<ProjectTransferRequest, "id">
  ): Promise<ProjectTransferRequestSummary> {
    return this.summaryById(record.id);
  }

  private async summaryById(
    id: string
  ): Promise<ProjectTransferRequestSummary> {
    const transfer = await this.prisma.projectTransferRequest.findUniqueOrThrow({
      where: { id },
      include: transferInclude
    });
    return (await this.summaries([transfer]))[0] as ProjectTransferRequestSummary;
  }

  private async summaries(
    transfers: readonly TransferWithProject[]
  ): Promise<readonly ProjectTransferRequestSummary[]> {
    const userIds = [
      ...new Set(
        transfers.flatMap(({ fromUserId, toUserId }) => [fromUserId, toUserId])
      )
    ];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, displayName: true, emailDisplay: true }
    });
    const usersById = new Map(users.map((user) => [user.id, user]));
    return transfers.map((transfer) =>
      this.summaryFromLoaded(transfer, usersById)
    );
  }

  private summaryFromLoaded(
    transfer: TransferWithProject,
    usersById: ReadonlyMap<
      string,
      Readonly<{ id: string; displayName: string; emailDisplay: string }>
    >
  ): ProjectTransferRequestSummary {
    const from = usersById.get(transfer.fromUserId);
    const to = usersById.get(transfer.toUserId);
    if (!from || !to) {
      throw stateConflict("Project transfer participants are unavailable");
    }
    return {
      id: transfer.id,
      workspaceId: transfer.workspaceId,
      workspaceName: transfer.sourceWorkspace.name,
      ...(transfer.destinationWorkspaceId && transfer.destinationWorkspace
        ? {
            destinationWorkspaceId: transfer.destinationWorkspaceId,
            destinationWorkspaceName: transfer.destinationWorkspace.name
          }
        : {}),
      projectId: transfer.projectId,
      projectName: transfer.project.name,
      fromUserId: transfer.fromUserId,
      fromDisplayName: from.displayName,
      toUserId: transfer.toUserId,
      toDisplayName: to.displayName,
      toEmail: to.emailDisplay,
      status: transfer.status,
      ...(transfer.lastErrorCode
        ? { processingErrorCode: transfer.lastErrorCode }
        : {}),
      expiresAt: transfer.expiresAt.toISOString(),
      createdAt: transfer.createdAt.toISOString()
    };
  }
}

async function availableProjectSlug(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  requestedSlug: string,
  projectId: string
): Promise<string> {
  const candidates = [
    requestedSlug,
    `${requestedSlug.slice(0, 91)}-${projectId.slice(0, 8)}`,
    `transfer-${projectId}`
  ];
  for (const candidate of candidates) {
    const conflict = await transaction.project.findFirst({
      where: { workspaceId, slug: candidate, id: { not: projectId } },
      select: { id: true }
    });
    if (!conflict) return candidate;
  }
  throw stateConflict("Destination workspace contains a conflicting project slug");
}

function reconcileErrorCode(error: unknown): string {
  if (error instanceof DomainError) {
    if (error.details?.reason === "ACTIVE_OPERATIONS") {
      return "ACTIVE_OPERATIONS";
    }
    if (error.code === "DEPENDENCY_UNAVAILABLE") return "DEPENDENCY_UNAVAILABLE";
    if (error.code === "RESOURCE_STATE_CONFLICT") return "STATE_CHANGED";
  }
  return "INTERNAL_ERROR";
}

function notFound(): DomainError {
  return new DomainError({
    statusCode: 404,
    code: "NOT_FOUND",
    message: "Project transfer request not found"
  });
}

function forbidden(message: string): DomainError {
  return new DomainError({ statusCode: 403, code: "FORBIDDEN", message });
}

function stateConflict(message: string): DomainError {
  return new DomainError({
    statusCode: 409,
    code: "RESOURCE_STATE_CONFLICT",
    message
  });
}

function validation(path: string, message: string): DomainError {
  return new DomainError({
    statusCode: 422,
    code: "VALIDATION_FAILED",
    message: "Request validation failed",
    fieldErrors: [{ path, code: "INVALID_TARGET", message }]
  });
}
