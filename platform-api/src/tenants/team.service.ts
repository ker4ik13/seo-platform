import { Inject, Injectable } from "@nestjs/common";
import {
  domainEventTypes,
  type CreateWorkspaceInviteInput,
  type CreateWorkspaceInviteResult,
  type ProjectAccessAssignment,
  type UpdateWorkspaceMemberInput,
  type WorkspaceInviteSummary,
  type WorkspaceMemberSummary
} from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";
import {
  DomainError,
  isUniqueConstraintError,
  validationError
} from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import { normalizeEmail } from "../common/normalization.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuthCryptoService } from "../identity/auth-crypto.service.js";
import type { RequestContext } from "../identity/identity.types.js";
import { OutboxService } from "../outbox/outbox.service.js";
import {
  storedProjectAccesses,
  toWorkspaceInviteSummary,
  toWorkspaceMemberSummary
} from "./team.mapper.js";

const ACTIVE_INVITE_STATUSES = ["SENT", "DELIVERED"] as const;

@Injectable()
export class TeamService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly crypto: AuthCryptoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async listMembers(
    workspaceId: string
  ): Promise<readonly WorkspaceMemberSummary[]> {
    assertUuid(workspaceId, "workspaceId");
    const members = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        status: { in: ["ACTIVE", "SUSPENDED"] }
      },
      include: {
        user: true,
        projectAccesses: {
          orderBy: { projectId: "asc" }
        }
      },
      orderBy: [{ joinedAt: "asc" }, { createdAt: "asc" }],
      take: 2_000
    });
    return members.map(toWorkspaceMemberSummary);
  }

  public async listInvites(
    workspaceId: string
  ): Promise<readonly WorkspaceInviteSummary[]> {
    assertUuid(workspaceId, "workspaceId");
    await this.expireInvites(workspaceId);
    const invites = await this.prisma.workspaceInvite.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 2_000
    });
    return invites.map(toWorkspaceInviteSummary);
  }

  public async createInvite(
    actorUserId: string,
    workspaceId: string,
    input: CreateWorkspaceInviteInput,
    context: RequestContext
  ): Promise<CreateWorkspaceInviteResult> {
    assertUuid(workspaceId, "workspaceId");
    const emailNormalized = normalizeEmail(input.email);
    const emailDisplay = input.email.normalize("NFKC").trim();
    await this.validateProjectAccesses(workspaceId, input.projectAccesses);
    await this.expireInvites(workspaceId);

    const existingUser = await this.prisma.user.findUnique({
      where: { emailNormalized },
      select: {
        memberships: {
          where: {
            workspaceId,
            status: { in: ["ACTIVE", "SUSPENDED"] }
          },
          select: { id: true },
          take: 1
        }
      }
    });
    if (existingUser?.memberships.length) {
      throw new DomainError({
        statusCode: 409,
        code: "DUPLICATE",
        message: "The user is already a workspace member"
      });
    }

    const activeInvite = await this.prisma.workspaceInvite.findFirst({
      where: {
        workspaceId,
        emailNormalized,
        status: { in: [...ACTIVE_INVITE_STATUSES] }
      }
    });
    if (activeInvite) {
      throw new DomainError({
        statusCode: 409,
        code: "DUPLICATE",
        message: "An active invitation already exists"
      });
    }

    const expiresAt = new Date(
      Date.now() + (input.expiresInDays ?? 7) * 24 * 60 * 60 * 1_000
    );

    try {
      const { invite, token } = await this.prisma.$transaction(
        async (transaction) => {
          const created = await transaction.workspaceInvite.create({
            data: {
              workspaceId,
              emailNormalized,
              emailDisplay,
              roleCode: input.roleCode,
              allProjects: input.allProjects,
              projectAccesses: input.projectAccesses.map(
                ({ projectId, level }) => ({ projectId, level })
              ),
              ...(input.message ? { message: input.message } : {}),
              tokenHash: this.crypto.hashOpaqueToken(
                this.crypto.randomToken()
              ),
              status: "SENT",
              invitedBy: actorUserId,
              expiresAt
            }
          });
          const invitationToken = this.crypto.workspaceInvitationToken(
            created.id,
            created.workspaceId,
            created.emailNormalized,
            created.expiresAt
          );
          const updated = await transaction.workspaceInvite.update({
            where: { id: created.id },
            data: {
              tokenHash: this.crypto.hashOpaqueToken(invitationToken)
            }
          });
          await this.audit.record(
            {
              actorId: actorUserId,
              workspaceId,
              action: "workspace.invite.created",
              resourceType: "workspaceInvite",
              resourceId: updated.id,
              requestId: context.requestId
            },
            transaction
          );
          await this.outbox.event(transaction, {
            eventType: domainEventTypes.workspaceInviteRequested,
            aggregateType: "workspaceInvite",
            aggregateId: updated.id,
            aggregateVersion: 1,
            workspaceId,
            payload: {
              inviteId: updated.id,
              workspaceId,
              expiresAt: updated.expiresAt.toISOString()
            },
            requestId: context.requestId
          });
          return { invite: updated, token: invitationToken };
        }
      );

      return {
        invite: toWorkspaceInviteSummary(invite),
        ...(this.config.auth.exposeDevelopmentTokens
          ? { invitationTokenForDevelopment: token }
          : {})
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new DomainError({
          statusCode: 409,
          code: "DUPLICATE",
          message: "An active invitation already exists"
        });
      }
      throw error;
    }
  }

  public async acceptInvite(
    userId: string,
    token: string,
    context: RequestContext
  ): Promise<WorkspaceMemberSummary> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });
    if (!user || user.status !== "ACTIVE") {
      throw new DomainError({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "An active account is required"
      });
    }
    if (!user.emailVerifiedAt) {
      throw new DomainError({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "Verify the account email before accepting an invitation"
      });
    }

    const invite = await this.prisma.workspaceInvite.findUnique({
      where: { tokenHash: this.crypto.hashOpaqueToken(token) },
      include: { workspace: true }
    });
    if (
      !invite ||
      !ACTIVE_INVITE_STATUSES.includes(
        invite.status as (typeof ACTIVE_INVITE_STATUSES)[number]
      )
    ) {
      throw this.inviteNotFound();
    }
    if (invite.expiresAt <= new Date()) {
      await this.prisma.workspaceInvite.updateMany({
        where: {
          id: invite.id,
          status: { in: [...ACTIVE_INVITE_STATUSES] }
        },
        data: { status: "EXPIRED" }
      });
      throw this.inviteNotFound();
    }
    if (invite.emailNormalized !== user.emailNormalized) {
      throw new DomainError({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "The invitation belongs to another verified email"
      });
    }
    if (
      ["SUSPENDED", "DELETING", "DELETED"].includes(invite.workspace.status)
    ) {
      throw new DomainError({
        statusCode: 409,
        code: "RESOURCE_STATE_CONFLICT",
        message: "The workspace cannot accept invitations"
      });
    }

    const assignments = storedProjectAccesses(invite.projectAccesses);
    const memberId = await this.prisma.$transaction(async (transaction) => {
      const accepted = await transaction.workspaceInvite.updateMany({
        where: {
          id: invite.id,
          status: { in: [...ACTIVE_INVITE_STATUSES] },
          expiresAt: { gt: new Date() }
        },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date()
        }
      });
      if (accepted.count !== 1) throw this.inviteNotFound();

      const currentMember = await transaction.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: invite.workspaceId,
            userId
          }
        }
      });
      if (
        currentMember &&
        ["ACTIVE", "SUSPENDED"].includes(currentMember.status)
      ) {
        throw new DomainError({
          statusCode: 409,
          code: "DUPLICATE",
          message: "The user is already a workspace member"
        });
      }

      const member = await transaction.workspaceMember.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: invite.workspaceId,
            userId
          }
        },
        create: {
          workspaceId: invite.workspaceId,
          userId,
          roleCode: invite.roleCode,
          allProjects: invite.allProjects,
          status: "ACTIVE",
          invitedBy: invite.invitedBy,
          joinedAt: new Date()
        },
        update: {
          roleCode: invite.roleCode,
          allProjects: invite.allProjects,
          status: "ACTIVE",
          invitedBy: invite.invitedBy,
          joinedAt: new Date(),
          version: { increment: 1 }
        }
      });
      await transaction.projectMemberAccess.deleteMany({
        where: { memberId: member.id }
      });
      if (assignments.length) {
        await transaction.projectMemberAccess.createMany({
          data: assignments.map(({ projectId, level }) => ({
            memberId: member.id,
            projectId,
            level
          }))
        });
      }

      await this.audit.record(
        {
          actorId: userId,
          workspaceId: invite.workspaceId,
          action: "workspace.invite.accepted",
          resourceType: "workspaceInvite",
          resourceId: invite.id,
          requestId: context.requestId
        },
        transaction
      );
      await this.outbox.event(transaction, {
        eventType: domainEventTypes.workspaceInviteAccepted,
        aggregateType: "workspaceInvite",
        aggregateId: invite.id,
        aggregateVersion: 1,
        workspaceId: invite.workspaceId,
        payload: {
          inviteId: invite.id,
          workspaceId: invite.workspaceId,
          memberId: member.id,
          userId
        },
        requestId: context.requestId
      });
      await this.recordMemberChanged(
        transaction,
        {
          memberId: member.id,
          memberVersion: member.version,
          workspaceId: invite.workspaceId,
          userId,
          roleCode: member.roleCode,
          allProjects: member.allProjects,
          change: "ADDED"
        },
        context.requestId
      );
      return member.id;
    });

    return this.memberById(invite.workspaceId, memberId);
  }

  public async updateMember(
    actorUserId: string,
    workspaceId: string,
    memberId: string,
    version: number,
    input: UpdateWorkspaceMemberInput,
    context: RequestContext
  ): Promise<WorkspaceMemberSummary> {
    assertUuid(workspaceId, "workspaceId");
    assertUuid(memberId, "memberId");
    await this.validateProjectAccesses(workspaceId, input.projectAccesses);

    const current = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId }
    });
    if (!current) throw this.memberNotFound();
    if (current.roleCode === "OWNER") {
      throw this.ownerRequiresTransfer();
    }

    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.workspaceMember.updateMany({
        where: {
          id: memberId,
          workspaceId,
          version,
          status: { in: ["ACTIVE", "SUSPENDED"] }
        },
        data: {
          roleCode: input.roleCode,
          allProjects: input.allProjects,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw this.versionConflict();

      await transaction.projectMemberAccess.deleteMany({
        where: { memberId }
      });
      if (input.projectAccesses.length) {
        await transaction.projectMemberAccess.createMany({
          data: input.projectAccesses.map(({ projectId, level }) => ({
            memberId,
            projectId,
            level
          }))
        });
      }
      const member = await transaction.workspaceMember.findUniqueOrThrow({
        where: { id: memberId }
      });
      await this.audit.record(
        {
          actorId: actorUserId,
          workspaceId,
          action: "workspace.member.updated",
          resourceType: "workspaceMember",
          resourceId: memberId,
          requestId: context.requestId
        },
        transaction
      );
      await this.recordMemberChanged(
        transaction,
        {
          memberId,
          memberVersion: member.version,
          workspaceId,
          userId: member.userId,
          roleCode: member.roleCode,
          allProjects: member.allProjects,
          change: "UPDATED"
        },
        context.requestId
      );
    });

    return this.memberById(workspaceId, memberId);
  }

  public async removeMember(
    actorUserId: string,
    workspaceId: string,
    memberId: string,
    version: number,
    context: RequestContext
  ): Promise<WorkspaceMemberSummary> {
    assertUuid(workspaceId, "workspaceId");
    assertUuid(memberId, "memberId");
    const current = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
      include: {
        user: true,
        projectAccesses: true
      }
    });
    if (!current) throw this.memberNotFound();
    if (current.roleCode === "OWNER") {
      throw this.ownerRequiresTransfer();
    }

    const removed = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.workspaceMember.updateMany({
        where: {
          id: memberId,
          workspaceId,
          version,
          status: { in: ["ACTIVE", "SUSPENDED"] }
        },
        data: {
          status: "REMOVED",
          allProjects: false,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw this.versionConflict();
      await transaction.projectMemberAccess.deleteMany({
        where: { memberId }
      });
      const member = await transaction.workspaceMember.findUniqueOrThrow({
        where: { id: memberId }
      });
      await this.audit.record(
        {
          actorId: actorUserId,
          workspaceId,
          action: "workspace.member.removed",
          resourceType: "workspaceMember",
          resourceId: memberId,
          requestId: context.requestId
        },
        transaction
      );
      await this.recordMemberChanged(
        transaction,
        {
          memberId,
          memberVersion: member.version,
          workspaceId,
          userId: member.userId,
          roleCode: member.roleCode,
          allProjects: false,
          change: "REMOVED"
        },
        context.requestId
      );
      return member;
    });

    return toWorkspaceMemberSummary({
      ...removed,
      user: current.user,
      projectAccesses: []
    });
  }

  public async revokeInvite(
    actorUserId: string,
    workspaceId: string,
    inviteId: string,
    context: RequestContext
  ): Promise<WorkspaceInviteSummary> {
    assertUuid(workspaceId, "workspaceId");
    assertUuid(inviteId, "inviteId");
    await this.expireInvites(workspaceId);

    const invite = await this.prisma.$transaction(async (transaction) => {
      const revoked = await transaction.workspaceInvite.updateMany({
        where: {
          id: inviteId,
          workspaceId,
          status: { in: [...ACTIVE_INVITE_STATUSES] }
        },
        data: {
          status: "REVOKED",
          revokedAt: new Date()
        }
      });
      if (revoked.count !== 1) throw this.inviteNotFound();
      const updated = await transaction.workspaceInvite.findUniqueOrThrow({
        where: { id: inviteId }
      });
      await this.audit.record(
        {
          actorId: actorUserId,
          workspaceId,
          action: "workspace.invite.revoked",
          resourceType: "workspaceInvite",
          resourceId: inviteId,
          requestId: context.requestId
        },
        transaction
      );
      await this.outbox.event(transaction, {
        eventType: domainEventTypes.workspaceInviteRevoked,
        aggregateType: "workspaceInvite",
        aggregateId: inviteId,
        aggregateVersion: 1,
        workspaceId,
        payload: { inviteId, workspaceId },
        requestId: context.requestId
      });
      return updated;
    });
    return toWorkspaceInviteSummary(invite);
  }

  private async validateProjectAccesses(
    workspaceId: string,
    assignments: readonly ProjectAccessAssignment[]
  ): Promise<void> {
    if (!assignments.length) return;
    const projectIds = assignments.map(({ projectId }) => projectId);
    const projects = await this.prisma.project.findMany({
      where: {
        id: { in: projectIds },
        workspaceId,
        status: { notIn: ["DELETING", "DELETED"] }
      },
      select: { id: true }
    });
    if (projects.length !== projectIds.length) {
      throw validationError(
        "projectAccesses",
        "PROJECT_NOT_AVAILABLE",
        "One or more projects are unavailable in this workspace"
      );
    }
  }

  private async expireInvites(workspaceId: string): Promise<void> {
    await this.prisma.workspaceInvite.updateMany({
      where: {
        workspaceId,
        status: { in: [...ACTIVE_INVITE_STATUSES] },
        expiresAt: { lte: new Date() }
      },
      data: { status: "EXPIRED" }
    });
  }

  private async memberById(
    workspaceId: string,
    memberId: string
  ): Promise<WorkspaceMemberSummary> {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
      include: {
        user: true,
        projectAccesses: {
          orderBy: { projectId: "asc" }
        }
      }
    });
    if (!member) throw this.memberNotFound();
    return toWorkspaceMemberSummary(member);
  }

  private async recordMemberChanged(
    transaction: Parameters<OutboxService["event"]>[0],
    input: {
      readonly memberId: string;
      readonly memberVersion: number;
      readonly workspaceId: string;
      readonly userId: string;
      readonly roleCode: string;
      readonly allProjects: boolean;
      readonly change: "ADDED" | "UPDATED" | "REMOVED";
    },
    requestId: string
  ): Promise<void> {
    await this.outbox.event(transaction, {
      eventType: domainEventTypes.workspaceMemberChanged,
      aggregateType: "workspaceMember",
      aggregateId: input.memberId,
      aggregateVersion: input.memberVersion,
      workspaceId: input.workspaceId,
      payload: {
        memberId: input.memberId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        roleCode: input.roleCode,
        allProjects: input.allProjects,
        change: input.change
      },
      requestId
    });
  }

  private versionConflict(): DomainError {
    return new DomainError({
      statusCode: 409,
      code: "VERSION_CONFLICT",
      message: "The workspace member has changed"
    });
  }

  private inviteNotFound(): DomainError {
    return new DomainError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Invitation not found"
    });
  }

  private memberNotFound(): DomainError {
    return new DomainError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Workspace member not found"
    });
  }

  private ownerRequiresTransfer(): DomainError {
    return new DomainError({
      statusCode: 409,
      code: "RESOURCE_STATE_CONFLICT",
      message: "Owner changes require the ownership transfer flow"
    });
  }
}
