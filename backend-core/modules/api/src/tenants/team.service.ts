import { Inject, Injectable } from "@nestjs/common";
import {
  domainEventTypes,
  type CursorPage,
  type CreateWorkspaceInviteInput,
  type CreateWorkspaceInviteResult,
  type PendingWorkspaceInviteSummary,
  type ProjectAccessAssignment,
  type UpdateWorkspaceMemberInput,
  type WorkspaceInviteListQuery,
  type WorkspaceInviteSummary,
  type WorkspaceMemberSummary,
  type WorkspaceTeamListQuery
} from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";
import {
  DomainError,
  isUniqueConstraintError,
  validationError
} from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import { normalizeEmail } from "../common/normalization.js";
import { databaseClock } from "../database/database-clock.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuthCryptoService } from "../identity/auth-crypto.service.js";
import type { RequestContext } from "../identity/identity.types.js";
import { OutboxService } from "../outbox/outbox.service.js";
import {
  openWorkspaceTeamCursor,
  sealWorkspaceTeamCursor,
  type WorkspaceTeamCursorContext
} from "./team-cursor.js";
import {
  storedProjectAccesses,
  toPendingWorkspaceInviteSummary,
  toWorkspaceInviteSummary,
  toWorkspaceMemberSummary
} from "./team.mapper.js";

const ACTIVE_INVITE_STATUSES = ["SENT", "DELIVERED"] as const;

interface TeamListResult<Data> {
  readonly data: readonly Data[];
  readonly page: CursorPage;
}

@Injectable()
export class TeamService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly crypto: AuthCryptoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly entitlements: BillingEntitlementService
  ) {}

  public async listMembers(
    workspaceId: string,
    query: WorkspaceTeamListQuery
  ): Promise<TeamListResult<WorkspaceMemberSummary>> {
    const normalizedWorkspaceId = assertUuid(workspaceId, "workspaceId");
    const cursorContext = {
      scope: "members",
      workspaceId: normalizedWorkspaceId
    } as const satisfies WorkspaceTeamCursorContext;
    const lastId = this.listCursor(query.cursor, cursorContext);
    const members = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId: normalizedWorkspaceId,
        status: { in: ["ACTIVE", "SUSPENDED"] },
        ...(lastId ? { id: { lt: lastId } } : {})
      },
      include: {
        user: true,
        projectAccesses: {
          where: {
            project: {
              workspaceId: normalizedWorkspaceId,
              status: { notIn: ["DELETING", "DELETED"] },
              deletedAt: null
            }
          },
          orderBy: { projectId: "asc" }
        }
      },
      orderBy: { id: "desc" },
      take: query.limit + 1
    });
    const pageMembers = members.slice(0, query.limit);
    return {
      data: pageMembers.map(toWorkspaceMemberSummary),
      page: this.listPage(
        pageMembers,
        members.length > query.limit,
        cursorContext
      )
    };
  }

  public async listInvites(
    workspaceId: string,
    query: WorkspaceInviteListQuery
  ): Promise<TeamListResult<WorkspaceInviteSummary>> {
    const normalizedWorkspaceId = assertUuid(workspaceId, "workspaceId");
    const cursorContext = {
      scope: "invites",
      workspaceId: normalizedWorkspaceId,
      status: query.status
    } as const satisfies WorkspaceTeamCursorContext;
    const lastId = this.listCursor(query.cursor, cursorContext);
    const now = new Date();
    await this.expireInvites(normalizedWorkspaceId, now);
    const invites = await this.prisma.workspaceInvite.findMany({
      where: {
        workspaceId: normalizedWorkspaceId,
        ...(query.status === "PENDING"
          ? {
              status: { in: [...ACTIVE_INVITE_STATUSES] },
              expiresAt: { gt: now }
            }
          : {}),
        ...(lastId ? { id: { lt: lastId } } : {})
      },
      orderBy: { id: "desc" },
      take: query.limit + 1
    });
    const pageInvites = invites.slice(0, query.limit);
    return {
      data: pageInvites.map(toWorkspaceInviteSummary),
      page: this.listPage(
        pageInvites,
        invites.length > query.limit,
        cursorContext
      )
    };
  }

  public async listPendingInvitesForUser(
    userId: string
  ): Promise<TeamListResult<PendingWorkspaceInviteSummary>> {
    const normalizedUserId = assertUuid(userId, "userId");
    const user = await this.prisma.user.findUnique({
      where: { id: normalizedUserId },
      select: {
        status: true,
        emailNormalized: true,
        emailVerifiedAt: true
      }
    });
    if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) {
      return { data: [], page: { hasNext: false } };
    }

    const now = new Date();
    await this.prisma.workspaceInvite.updateMany({
      where: {
        emailNormalized: user.emailNormalized,
        status: { in: [...ACTIVE_INVITE_STATUSES] },
        expiresAt: { lte: now }
      },
      data: { status: "EXPIRED" }
    });
    const invites = await this.prisma.workspaceInvite.findMany({
      where: {
        emailNormalized: user.emailNormalized,
        status: { in: [...ACTIVE_INVITE_STATUSES] },
        expiresAt: { gt: now },
        workspace: { status: { notIn: ["DELETING", "DELETED"] } }
      },
      include: {
        workspace: {
          select: { name: true, slug: true, status: true }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    return {
      data: invites.map(toPendingWorkspaceInviteSummary),
      page: { hasNext: false }
    };
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
    const projectAccesses = await this.availableProjectAccesses(
      workspaceId,
      input.projectAccesses,
      input.allProjects
    );
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
          await this.entitlements.assertCanCreateInvite(
            transaction,
            workspaceId,
            input.roleCode
          );
          const created = await transaction.workspaceInvite.create({
            data: {
              workspaceId,
              emailNormalized,
              emailDisplay,
              roleCode: input.roleCode,
              allProjects: input.allProjects,
              projectAccesses: projectAccesses.map(
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
    const tokenHash = this.crypto.hashOpaqueToken(token);
    const candidate = await this.prisma.workspaceInvite.findUnique({
      where: { tokenHash },
      select: { id: true, workspaceId: true }
    });
    if (!candidate) throw this.inviteNotFound();
    return this.acceptInviteCandidate(userId, candidate, context, tokenHash);
  }

  public async acceptInviteById(
    userId: string,
    inviteId: string,
    context: RequestContext
  ): Promise<WorkspaceMemberSummary> {
    const normalizedInviteId = assertUuid(inviteId, "inviteId");
    const candidate = await this.prisma.workspaceInvite.findUnique({
      where: { id: normalizedInviteId },
      select: { id: true, workspaceId: true }
    });
    if (!candidate) throw this.inviteNotFound();
    return this.acceptInviteCandidate(userId, candidate, context);
  }

  public async declineInvite(
    userId: string,
    inviteId: string,
    context: RequestContext
  ): Promise<WorkspaceInviteSummary> {
    const normalizedInviteId = assertUuid(inviteId, "inviteId");
    const candidate = await this.prisma.workspaceInvite.findUnique({
      where: { id: normalizedInviteId },
      select: { id: true, workspaceId: true }
    });
    if (!candidate) throw this.inviteNotFound();

    const result = await this.prisma.$transaction(async (transaction) => {
      await this.lockInviteAcceptanceRows(
        transaction,
        userId,
        candidate.workspaceId,
        candidate.id
      );
      const user = await transaction.user.findUnique({ where: { id: userId } });
      if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) {
        throw new DomainError({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "An active verified account is required"
        });
      }
      const invite = await transaction.workspaceInvite.findUnique({
        where: { id: candidate.id }
      });
      if (
        !invite ||
        invite.workspaceId !== candidate.workspaceId ||
        invite.emailNormalized !== user.emailNormalized ||
        !ACTIVE_INVITE_STATUSES.includes(
          invite.status as (typeof ACTIVE_INVITE_STATUSES)[number]
        )
      ) {
        throw this.inviteNotFound();
      }
      const now = await this.databaseNow(transaction);
      if (invite.expiresAt <= now) {
        await transaction.workspaceInvite.updateMany({
          where: {
            id: invite.id,
            status: { in: [...ACTIVE_INVITE_STATUSES] },
            expiresAt: { lte: now }
          },
          data: { status: "EXPIRED" }
        });
        return { kind: "EXPIRED" } as const;
      }
      const declined = await transaction.workspaceInvite.updateMany({
        where: {
          id: invite.id,
          status: { in: [...ACTIVE_INVITE_STATUSES] },
          expiresAt: { gt: now }
        },
        data: { status: "DECLINED", declinedAt: now }
      });
      if (declined.count !== 1) throw this.inviteNotFound();
      const updated = await transaction.workspaceInvite.findUniqueOrThrow({
        where: { id: invite.id }
      });
      await this.audit.record(
        {
          actorId: userId,
          workspaceId: invite.workspaceId,
          action: "workspace.invite.declined",
          resourceType: "workspaceInvite",
          resourceId: invite.id,
          requestId: context.requestId
        },
        transaction
      );
      await this.outbox.event(transaction, {
        eventType: domainEventTypes.workspaceInviteDeclined,
        aggregateType: "workspaceInvite",
        aggregateId: invite.id,
        aggregateVersion: 1,
        workspaceId: invite.workspaceId,
        payload: { inviteId: invite.id, workspaceId: invite.workspaceId, userId },
        requestId: context.requestId
      });
      return {
        kind: "DECLINED",
        invite: toWorkspaceInviteSummary(updated)
      } as const;
    });
    if (result.kind === "EXPIRED") throw this.inviteNotFound();
    return result.invite;
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
    const projectAccesses = await this.availableProjectAccesses(
      workspaceId,
      input.projectAccesses,
      input.allProjects
    );

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
      if (projectAccesses.length) {
        await transaction.projectMemberAccess.createMany({
          data: projectAccesses.map(({ projectId, level }) => ({
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

  private async acceptInviteCandidate(
    userId: string,
    candidate: { readonly id: string; readonly workspaceId: string },
    context: RequestContext,
    tokenHash?: string
  ): Promise<WorkspaceMemberSummary> {
    const result = await this.prisma.$transaction(async (transaction) => {
      await this.lockInviteAcceptanceRows(
        transaction,
        userId,
        candidate.workspaceId,
        candidate.id
      );
      const user = await transaction.user.findUnique({ where: { id: userId } });
      if (!user || user.status !== "ACTIVE") {
        throw new DomainError({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "An active account is required"
        });
      }
      if (!user.emailVerifiedAt) {
        throw new DomainError({
          statusCode: 409,
          code: "EMAIL_VERIFICATION_REQUIRED",
          message: "Verify the account email before accepting an invitation"
        });
      }

      const invite = await transaction.workspaceInvite.findUnique({
        where: { id: candidate.id },
        include: { workspace: true }
      });
      if (
        !invite ||
        invite.workspaceId !== candidate.workspaceId ||
        (tokenHash !== undefined && invite.tokenHash !== tokenHash) ||
        !ACTIVE_INVITE_STATUSES.includes(
          invite.status as (typeof ACTIVE_INVITE_STATUSES)[number]
        )
      ) {
        throw this.inviteNotFound();
      }

      const now = await this.databaseNow(transaction);
      if (invite.expiresAt <= now) {
        await transaction.workspaceInvite.updateMany({
          where: {
            id: invite.id,
            ...(tokenHash ? { tokenHash } : {}),
            status: { in: [...ACTIVE_INVITE_STATUSES] },
            expiresAt: { lte: now }
          },
          data: { status: "EXPIRED" }
        });
        return { kind: "EXPIRED" } as const;
      }
      if (invite.emailNormalized !== user.emailNormalized) {
        if (tokenHash === undefined) throw this.inviteNotFound();
        throw new DomainError({
          statusCode: 403,
          code: "INVITATION_ACCOUNT_MISMATCH",
          message: "The invitation belongs to another verified account"
        });
      }
      if (["SUSPENDED", "DELETING", "DELETED"].includes(invite.workspace.status)) {
        throw new DomainError({
          statusCode: 409,
          code: "RESOURCE_STATE_CONFLICT",
          message: "The workspace cannot accept invitations"
        });
      }

      await transaction.$queryRaw<readonly { id: string }[]>`
        SELECT id
        FROM workspace_members
        WHERE workspace_id = ${invite.workspaceId}::uuid
          AND user_id = ${userId}::uuid
        FOR UPDATE
      `;
      const assignments = storedProjectAccesses(invite.projectAccesses);
      const accepted = await transaction.workspaceInvite.updateMany({
        where: {
          id: invite.id,
          ...(tokenHash ? { tokenHash } : {}),
          status: { in: [...ACTIVE_INVITE_STATUSES] },
          expiresAt: { gt: now }
        },
        data: { status: "ACCEPTED", acceptedAt: now }
      });
      if (accepted.count !== 1) throw this.inviteNotFound();

      const currentMember = await transaction.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: invite.workspaceId, userId }
        }
      });
      if (currentMember && ["ACTIVE", "SUSPENDED"].includes(currentMember.status)) {
        throw new DomainError({
          statusCode: 409,
          code: "DUPLICATE",
          message: "The user is already a workspace member"
        });
      }
      await this.entitlements.assertCanAcceptInvite(
        transaction,
        invite.workspaceId,
        invite.roleCode
      );

      const member = await transaction.workspaceMember.upsert({
        where: {
          workspaceId_userId: { workspaceId: invite.workspaceId, userId }
        },
        create: {
          workspaceId: invite.workspaceId,
          userId,
          roleCode: invite.roleCode,
          allProjects: invite.allProjects,
          status: "ACTIVE",
          invitedBy: invite.invitedBy,
          joinedAt: now
        },
        update: {
          roleCode: invite.roleCode,
          allProjects: invite.allProjects,
          status: "ACTIVE",
          invitedBy: invite.invitedBy,
          joinedAt: now,
          version: { increment: 1 }
        }
      });
      await transaction.projectMemberAccess.deleteMany({ where: { memberId: member.id } });
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
      const summary = await transaction.workspaceMember.findUnique({
        where: { id: member.id },
        include: {
          user: true,
          projectAccesses: {
            where: {
              project: {
                workspaceId: invite.workspaceId,
                status: { notIn: ["DELETING", "DELETED"] },
                deletedAt: null
              }
            },
            orderBy: { projectId: "asc" }
          }
        }
      });
      if (!summary) throw this.memberNotFound();
      return {
        kind: "ACCEPTED",
        member: toWorkspaceMemberSummary(summary)
      } as const;
    });
    if (result.kind === "EXPIRED") throw this.inviteNotFound();
    return result.member;
  }

  private async lockInviteAcceptanceRows(
    transaction: Parameters<OutboxService["event"]>[0],
    userId: string,
    workspaceId: string,
    inviteId: string
  ): Promise<void> {
    // Canonical order: user lifecycle -> workspace lifecycle -> invitation.
    // Every authoritative row is re-read after these locks are held.
    await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT id
      FROM users
      WHERE id = ${userId}::uuid
      FOR UPDATE
    `;
    await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT id
      FROM workspaces
      WHERE id = ${workspaceId}::uuid
      FOR UPDATE
    `;
    await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT id
      FROM workspace_invites
      WHERE id = ${inviteId}::uuid
      FOR UPDATE
    `;
  }

  private async databaseNow(
    transaction: Parameters<OutboxService["event"]>[0]
  ): Promise<Date> {
    return databaseClock(transaction);
  }

  private async availableProjectAccesses(
    workspaceId: string,
    assignments: readonly ProjectAccessAssignment[],
    allProjects: boolean
  ): Promise<readonly ProjectAccessAssignment[]> {
    if (!assignments.length) return assignments;
    const projectIds = assignments.map(({ projectId }) => projectId);
    const projects = await this.prisma.project.findMany({
      where: {
        id: { in: projectIds },
        workspaceId
      },
      select: { id: true, status: true, deletedAt: true }
    });
    if (projects.length !== projectIds.length) {
      throw validationError(
        "projectAccesses",
        "PROJECT_NOT_AVAILABLE",
        "One or more projects are unavailable in this workspace"
      );
    }
    const deletedIds = new Set(
      projects
        .filter(
          ({ status, deletedAt }) =>
            deletedAt !== null || ["DELETING", "DELETED"].includes(status)
        )
        .map(({ id }) => id)
    );
    const available = assignments.filter(
      ({ projectId }) => !deletedIds.has(projectId)
    );
    if (
      !allProjects &&
      !available.some(({ level }) => level !== "NONE")
    ) {
      throw validationError(
        "projectAccesses",
        "PROJECT_ACCESS_REQUIRED",
        "Select at least one accessible project"
      );
    }
    return available;
  }

  private async expireInvites(
    workspaceId: string,
    now = new Date()
  ): Promise<void> {
    await this.prisma.workspaceInvite.updateMany({
      where: {
        workspaceId,
        status: { in: [...ACTIVE_INVITE_STATUSES] },
        expiresAt: { lte: now }
      },
      data: { status: "EXPIRED" }
    });
  }

  private listCursor(
    value: string | undefined,
    context: WorkspaceTeamCursorContext
  ): string | undefined {
    if (!value) return undefined;
    try {
      return openWorkspaceTeamCursor(this.crypto, value, context);
    } catch {
      throw validationError(
        "cursor",
        "INVALID_CURSOR",
        "Team list cursor is invalid"
      );
    }
  }

  private listPage(
    items: readonly { readonly id: string }[],
    hasNext: boolean,
    context: WorkspaceTeamCursorContext
  ): CursorPage {
    const last = hasNext ? items[items.length - 1] : undefined;
    return {
      hasNext,
      ...(last
        ? {
            nextCursor: sealWorkspaceTeamCursor(
              this.crypto,
              context,
              last.id
            )
          }
        : {})
    };
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
          where: {
            project: {
              workspaceId,
              status: { notIn: ["DELETING", "DELETED"] },
              deletedAt: null
            }
          },
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
