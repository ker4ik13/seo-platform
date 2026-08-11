import { Injectable } from "@nestjs/common";
import {
  domainEventTypes,
  type CreateProjectInput,
  type CreateWorkspaceInput,
  type DeleteProjectInput,
  type ProjectDeletionResult,
  type ProjectSummary,
  type UpdateProjectInput,
  type UpdateWorkspaceInput,
  type WorkspaceSummary
} from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import { BillingEntitlementService } from "../billing/billing-entitlement.service.js";
import {
  DomainError,
  isUniqueConstraintError,
  validationError
} from "../common/domain-error.js";
import {
  generatedSlug,
  normalizeCountry,
  normalizeDomain,
  normalizeLocale,
  normalizeSlug,
  normalizeTimezone
} from "../common/normalization.js";
import { PrismaService } from "../database/prisma.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import type { RequestContext } from "../identity/identity.types.js";
import {
  toProjectSummary,
  toWorkspaceSummary
} from "./tenant.mapper.js";
import type { WorkspaceAvatarInput } from "./tenant-input.js";

interface WorkspaceOwnerRecord {
  readonly id: string;
  readonly emailDisplay: string;
  readonly displayName: string;
}

export interface WorkspaceAvatar {
  readonly contentType: string;
  readonly data: Buffer;
  readonly updatedAt: Date;
}

@Injectable()
export class TenantService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly entitlements: BillingEntitlementService
  ) {}

  public async listWorkspaces(
    userId: string
  ): Promise<readonly WorkspaceSummary[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: {
        userId,
        status: "ACTIVE",
        workspace: {
          status: { notIn: ["DELETING", "DELETED"] }
        }
      },
      include: { workspace: true },
      orderBy: { createdAt: "asc" },
      take: 500
    });
    if (memberships.length === 0) return [];
    const owners = await this.prisma.user.findMany({
      where: {
        id: {
          in: [...new Set(memberships.map(({ workspace }) => workspace.ownerUserId))]
        }
      },
      select: {
        id: true,
        emailDisplay: true,
        displayName: true
      }
    });
    const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
    return memberships.map(({ workspace, roleCode }) =>
      toWorkspaceSummary(
        workspace,
        roleCode,
        requiredWorkspaceOwner(ownerById, workspace.ownerUserId)
      )
    );
  }

  public async createWorkspace(
    userId: string,
    input: CreateWorkspaceInput,
    context: RequestContext
  ): Promise<WorkspaceSummary> {
    const slug = input.slug
      ? normalizeSlug(input.slug)
      : generatedSlug(input.name, "workspace");
    const country = normalizeCountry(input.country);

    try {
      const workspace = await this.prisma.$transaction(
        async (transaction) => {
          const created = await transaction.workspace.create({
            data: {
              name: input.name.trim(),
              slug,
              ...(country ? { country } : {}),
              locale: normalizeLocale(input.locale),
              timezone: normalizeTimezone(input.timezone),
              billingCurrency: input.billingCurrency.toUpperCase(),
              ownerUserId: userId,
              members: {
                create: {
                  userId,
                  roleCode: "OWNER",
                  status: "ACTIVE",
                  joinedAt: new Date()
                }
              }
            }
          });
          await this.audit.record(
            {
              actorId: userId,
              workspaceId: created.id,
              action: "workspace.created",
              resourceType: "workspace",
              resourceId: created.id,
              requestId: context.requestId
            },
            transaction
          );
          await this.outbox.event(transaction, {
            eventType: domainEventTypes.workspaceCreated,
            aggregateType: "workspace",
            aggregateId: created.id,
            aggregateVersion: created.version,
            workspaceId: created.id,
            payload: {
              workspaceId: created.id,
              ownerUserId: userId,
              locale: created.locale,
              timezone: created.timezone
            },
            requestId: context.requestId
          });
          return created;
        }
      );
      return toWorkspaceSummary(
        workspace,
        "OWNER",
        await this.workspaceOwner(workspace.ownerUserId)
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new DomainError({
          statusCode: 409,
          code: "DUPLICATE",
          message: "Workspace slug is already in use"
        });
      }
      throw error;
    }
  }

  public async getWorkspace(
    userId: string,
    workspaceId: string
  ): Promise<WorkspaceSummary> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { workspace: true }
    });
    if (!membership || membership.status !== "ACTIVE") throw this.notFound();
    return toWorkspaceSummary(
      membership.workspace,
      membership.roleCode,
      await this.workspaceOwner(membership.workspace.ownerUserId)
    );
  }

  public async updateWorkspace(
    userId: string,
    workspaceId: string,
    version: number,
    input: UpdateWorkspaceInput,
    context: RequestContext
  ): Promise<WorkspaceSummary> {
    const countryUpdate =
      input.country === undefined
        ? {}
        : {
            country:
              input.country === null
                ? null
                : (normalizeCountry(input.country) ?? null)
          };
    const result = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.workspace.updateMany({
        where: {
          id: workspaceId,
          version,
          status: { notIn: ["DELETING", "DELETED"] }
        },
        data: {
          ...(input.name ? { name: input.name.trim() } : {}),
          ...(input.locale ? { locale: normalizeLocale(input.locale) } : {}),
          ...(input.timezone
            ? { timezone: normalizeTimezone(input.timezone) }
            : {}),
          ...countryUpdate,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw this.versionConflict();

      const workspace = await transaction.workspace.findUniqueOrThrow({
        where: { id: workspaceId }
      });
      await this.audit.record(
        {
          actorId: userId,
          workspaceId,
          action: "workspace.updated",
          resourceType: "workspace",
          resourceId: workspaceId,
          requestId: context.requestId
        },
        transaction
      );
      await this.outbox.event(transaction, {
        eventType: domainEventTypes.workspaceUpdated,
        aggregateType: "workspace",
        aggregateId: workspaceId,
        aggregateVersion: workspace.version,
        workspaceId,
        payload: { workspaceId },
        requestId: context.requestId
      });
      return workspace;
    });

    const [membership, owner] = await Promise.all([
      this.prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId, userId } }
      }),
      this.workspaceOwner(result.ownerUserId)
    ]);
    return toWorkspaceSummary(result, membership.roleCode, owner);
  }

  public async getWorkspaceAvatar(
    userId: string,
    workspaceId: string
  ): Promise<WorkspaceAvatar> {
    const workspace = await this.prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        members: { some: { userId, status: "ACTIVE" } }
      },
      select: {
        avatarMimeType: true,
        avatarData: true,
        avatarUpdatedAt: true
      }
    });
    if (
      !workspace?.avatarMimeType ||
      !workspace.avatarData ||
      !workspace.avatarUpdatedAt
    ) {
      throw this.notFound();
    }
    return {
      contentType: workspace.avatarMimeType,
      data: Buffer.from(workspace.avatarData),
      updatedAt: workspace.avatarUpdatedAt
    };
  }

  public async updateWorkspaceAvatar(
    userId: string,
    workspaceId: string,
    version: number,
    input: WorkspaceAvatarInput,
    context: RequestContext
  ): Promise<WorkspaceSummary> {
    return this.setWorkspaceAvatar(
      userId,
      workspaceId,
      version,
      input,
      context
    );
  }

  public async deleteWorkspaceAvatar(
    userId: string,
    workspaceId: string,
    version: number,
    context: RequestContext
  ): Promise<WorkspaceSummary> {
    return this.setWorkspaceAvatar(
      userId,
      workspaceId,
      version,
      undefined,
      context
    );
  }

  private async setWorkspaceAvatar(
    userId: string,
    workspaceId: string,
    version: number,
    avatar: WorkspaceAvatarInput | undefined,
    context: RequestContext
  ): Promise<WorkspaceSummary> {
    const avatarUpdatedAt = avatar ? new Date() : null;
    const result = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.workspace.updateMany({
        where: {
          id: workspaceId,
          version,
          status: { notIn: ["DELETING", "DELETED"] }
        },
        data: {
          avatarMimeType: avatar?.contentType ?? null,
          avatarData: avatar ? Uint8Array.from(avatar.data) : null,
          avatarUpdatedAt,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw this.versionConflict();
      const workspace = await transaction.workspace.findUniqueOrThrow({
        where: { id: workspaceId }
      });
      await this.audit.record(
        {
          actorId: userId,
          workspaceId,
          action: avatar ? "workspace.avatar.updated" : "workspace.avatar.deleted",
          resourceType: "workspace",
          resourceId: workspaceId,
          requestId: context.requestId
        },
        transaction
      );
      await this.outbox.event(transaction, {
        eventType: domainEventTypes.workspaceUpdated,
        aggregateType: "workspace",
        aggregateId: workspaceId,
        aggregateVersion: workspace.version,
        workspaceId,
        payload: { workspaceId },
        requestId: context.requestId
      });
      return workspace;
    });
    const [membership, owner] = await Promise.all([
      this.prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId, userId } }
      }),
      this.workspaceOwner(result.ownerUserId)
    ]);
    return toWorkspaceSummary(result, membership.roleCode, owner);
  }

  private async workspaceOwner(ownerUserId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: ownerUserId },
      select: {
        id: true,
        emailDisplay: true,
        displayName: true
      }
    });
  }

  public async listProjects(
    userId: string,
    workspaceId: string
  ): Promise<readonly ProjectSummary[]> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId
        }
      },
      select: {
        id: true,
        allProjects: true
      }
    });
    if (!membership) throw this.notFound();

    const projects = await this.prisma.project.findMany({
      where: {
        workspaceId,
        status: { notIn: ["DELETING", "DELETED"] },
        ...(membership.allProjects
          ? {
              memberAccesses: {
                none: {
                  memberId: membership.id,
                  level: "NONE"
                }
              }
            }
          : {
              memberAccesses: {
                some: {
                  memberId: membership.id,
                  level: { not: "NONE" }
                }
              }
            })
      },
      include: {
        logo: {
          select: { source: true, imageUpdatedAt: true }
        },
        memberAccesses: {
          where: { memberId: membership.id },
          select: { level: true },
          take: 1
        }
      },
      orderBy: { createdAt: "asc" },
      take: 1_000
    });
    return projects.map(({ logo, memberAccesses, ...project }) =>
      toProjectSummary(project, memberAccesses[0]?.level, logo)
    );
  }

  public async createProject(
    userId: string,
    workspaceId: string,
    input: CreateProjectInput,
    context: RequestContext
  ): Promise<ProjectSummary> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId }
    });
    if (!workspace) throw this.notFound();
    if (workspace.status !== "ACTIVE") {
      throw new DomainError({
        statusCode: 402,
        code: "PAYMENT_REQUIRED",
        message: "New projects are unavailable in workspace read-only mode"
      });
    }

    const domain = normalizeDomain(input.domain);
    await this.ensureDuplicateDomainConfirmed(
      workspaceId,
      domain,
      input.confirmDuplicateDomain ?? false
    );
    const slug = input.slug
      ? normalizeSlug(input.slug)
      : generatedSlug(input.name, "project");

    try {
      const project = await this.prisma.$transaction(async (transaction) => {
        await this.entitlements.assertCanCreateProject(
          transaction,
          workspaceId
        );
        const created = await transaction.project.create({
          data: {
            workspaceId,
            name: input.name.trim(),
            slug,
            domain,
            locale: normalizeLocale(input.locale ?? workspace.locale),
            timezone: normalizeTimezone(
              input.timezone ?? workspace.timezone
            ),
            status: "ACTIVE",
            createdBy: userId,
            ownerUserId: workspace.ownerUserId
          }
        });
        await this.audit.record(
          {
            actorId: userId,
            workspaceId,
            projectId: created.id,
            action: "project.created",
            resourceType: "project",
            resourceId: created.id,
            requestId: context.requestId
          },
          transaction
        );
        await this.outbox.event(transaction, {
          eventType: domainEventTypes.projectCreated,
          aggregateType: "project",
          aggregateId: created.id,
          aggregateVersion: created.version,
          workspaceId,
          projectId: created.id,
          payload: {
            workspaceId,
            projectId: created.id,
            domain: created.domain
          },
          requestId: context.requestId
        });
        return created;
      });
      return toProjectSummary(project);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new DomainError({
          statusCode: 409,
          code: "DUPLICATE",
          message: "Project slug is already in use in this workspace"
        });
      }
      throw error;
    }
  }

  public async getProject(projectId: string): Promise<ProjectSummary> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        logo: { select: { source: true, imageUpdatedAt: true } }
      }
    });
    if (!project || ["DELETING", "DELETED"].includes(project.status)) {
      throw this.notFound();
    }
    return toProjectSummary(project, undefined, project.logo);
  }

  public async updateProject(
    userId: string,
    projectId: string,
    version: number,
    input: UpdateProjectInput,
    context: RequestContext
  ): Promise<ProjectSummary> {
    const current = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, domain: true, workspaceId: true }
    });
    if (!current) throw this.notFound();
    const domain = input.domain ? normalizeDomain(input.domain) : undefined;
    if (domain && domain !== current.domain) {
      await this.ensureDuplicateDomainConfirmed(
        current.workspaceId,
        domain,
        input.confirmDuplicateDomain ?? false,
        projectId
      );
    }

    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.project.updateMany({
        where: {
          id: projectId,
          version,
          status: { in: ["DRAFT", "ACTIVE"] }
        },
        data: {
          ...(input.name ? { name: input.name.trim() } : {}),
          ...(domain ? { domain } : {}),
          ...(input.locale ? { locale: normalizeLocale(input.locale) } : {}),
          ...(input.timezone
            ? { timezone: normalizeTimezone(input.timezone) }
            : {}),
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw this.versionConflict();
      if (domain && domain !== current.domain) {
        await transaction.projectLogo.deleteMany({
          where: {
            projectId,
            OR: [{ source: null }, { source: "DISCOVERED" }]
          }
        });
      }
      const project = await transaction.project.findUniqueOrThrow({
        where: { id: projectId },
        include: {
          logo: { select: { source: true, imageUpdatedAt: true } }
        }
      });
      await this.audit.record(
        {
          actorId: userId,
          workspaceId: project.workspaceId,
          projectId,
          action: "project.updated",
          resourceType: "project",
          resourceId: projectId,
          requestId: context.requestId
        },
        transaction
      );
      await this.outbox.event(transaction, {
        eventType: domainEventTypes.projectUpdated,
        aggregateType: "project",
        aggregateId: projectId,
        aggregateVersion: project.version,
        workspaceId: project.workspaceId,
        projectId,
        payload: { projectId, workspaceId: project.workspaceId },
        requestId: context.requestId
      });
      return toProjectSummary(project, undefined, project.logo);
    });
  }

  public async archiveProject(
    userId: string,
    projectId: string,
    version: number,
    context: RequestContext
  ): Promise<ProjectSummary> {
    return this.changeProjectStatus(
      userId,
      projectId,
      version,
      "ARCHIVED",
      domainEventTypes.projectArchived,
      "project.archived",
      context
    );
  }

  public async restoreProject(
    userId: string,
    projectId: string,
    version: number,
    context: RequestContext
  ): Promise<ProjectSummary> {
    return this.changeProjectStatus(
      userId,
      projectId,
      version,
      "ACTIVE",
      domainEventTypes.projectRestored,
      "project.restored",
      context
    );
  }

  public async deleteProject(
    userId: string,
    projectId: string,
    version: number,
    input: DeleteProjectInput,
    context: RequestContext
  ): Promise<ProjectDeletionResult> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          name: true,
          workspaceId: true,
          status: true,
          version: true
        }
      });
      if (!current || ["DELETING", "DELETED"].includes(current.status)) {
        throw this.notFound();
      }
      if (input.confirmation !== current.name) {
        throw validationError(
          "confirmation",
          "CONFIRMATION_MISMATCH",
          "Project name confirmation does not match"
        );
      }
      const activeTransfer = await transaction.projectTransferRequest.findFirst({
        where: {
          projectId,
          status: { in: ["PENDING", "PROCESSING"] }
        },
        select: { id: true }
      });
      if (activeTransfer) {
        throw new DomainError({
          statusCode: 409,
          code: "RESOURCE_STATE_CONFLICT",
          message: "Project cannot be deleted during an active transfer"
        });
      }
      const deletedAt = new Date();
      const updated = await transaction.project.updateMany({
        where: {
          id: projectId,
          version,
          status: { in: ["DRAFT", "ACTIVE", "ARCHIVED"] }
        },
        data: {
          status: "DELETED",
          archivedAt: deletedAt,
          deletedAt,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw this.versionConflict();
      await this.audit.record(
        {
          actorId: userId,
          workspaceId: current.workspaceId,
          projectId,
          action: "project.deleted",
          resourceType: "project",
          resourceId: projectId,
          requestId: context.requestId
        },
        transaction
      );
      await this.outbox.event(transaction, {
        eventType: domainEventTypes.projectDeleted,
        aggregateType: "project",
        aggregateId: projectId,
        aggregateVersion: current.version + 1,
        workspaceId: current.workspaceId,
        projectId,
        payload: {
          projectId,
          workspaceId: current.workspaceId,
          deletedAt: deletedAt.toISOString()
        },
        requestId: context.requestId
      });
      return {
        projectId,
        status: "DELETED",
        deletedAt: deletedAt.toISOString()
      };
    });
  }

  private async changeProjectStatus(
    userId: string,
    projectId: string,
    version: number,
    status: "ACTIVE" | "ARCHIVED",
    eventType: string,
    action: string,
    context: RequestContext
  ): Promise<ProjectSummary> {
    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.project.updateMany({
        where: {
          id: projectId,
          version,
          status:
            status === "ARCHIVED"
              ? { in: ["DRAFT", "ACTIVE"] }
              : "ARCHIVED"
        },
        data: {
          status,
          archivedAt: status === "ARCHIVED" ? new Date() : null,
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw this.versionConflict();
      const project = await transaction.project.findUniqueOrThrow({
        where: { id: projectId },
        include: {
          logo: { select: { source: true, imageUpdatedAt: true } }
        }
      });
      await this.audit.record(
        {
          actorId: userId,
          workspaceId: project.workspaceId,
          projectId,
          action,
          resourceType: "project",
          resourceId: projectId,
          requestId: context.requestId
        },
        transaction
      );
      await this.outbox.event(transaction, {
        eventType,
        aggregateType: "project",
        aggregateId: projectId,
        aggregateVersion: project.version,
        workspaceId: project.workspaceId,
        projectId,
        payload: {
          projectId,
          workspaceId: project.workspaceId,
          status
        },
        requestId: context.requestId
      });
      return toProjectSummary(project, undefined, project.logo);
    });
  }

  private async ensureDuplicateDomainConfirmed(
    workspaceId: string,
    domain: string,
    confirmed: boolean,
    excludeProjectId?: string
  ): Promise<void> {
    if (confirmed) return;
    const duplicate = await this.prisma.project.findFirst({
      where: {
        workspaceId,
        domain,
        status: { notIn: ["DELETING", "DELETED"] },
        ...(excludeProjectId ? { id: { not: excludeProjectId } } : {})
      },
      select: { id: true, name: true }
    });
    if (duplicate) {
      throw new DomainError({
        statusCode: 409,
        code: "RESOURCE_STATE_CONFLICT",
        message: "A project with this domain already exists",
        details: {
          requiresConfirmation: true,
          existingProjectId: duplicate.id,
          existingProjectName: duplicate.name
        }
      });
    }
  }

  private versionConflict(): DomainError {
    return new DomainError({
      statusCode: 412,
      code: "VERSION_CONFLICT",
      message: "Resource was changed by another user"
    });
  }

  private notFound(): DomainError {
    return new DomainError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Resource not found"
    });
  }
}

function requiredWorkspaceOwner(
  owners: ReadonlyMap<string, WorkspaceOwnerRecord>,
  ownerUserId: string
): WorkspaceOwnerRecord {
  const owner = owners.get(ownerUserId);
  if (!owner) {
    throw new Error("Workspace owner record is missing");
  }
  return owner;
}
