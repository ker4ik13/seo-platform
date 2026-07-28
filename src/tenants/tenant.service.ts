import { Injectable } from "@nestjs/common";
import {
  domainEventTypes,
  type CreateProjectInput,
  type CreateWorkspaceInput,
  type ProjectSummary,
  type UpdateProjectInput,
  type UpdateWorkspaceInput,
  type WorkspaceSummary
} from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import {
  DomainError,
  isUniqueConstraintError
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

@Injectable()
export class TenantService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService
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
    return memberships.map(({ workspace, roleCode }) =>
      toWorkspaceSummary(workspace, roleCode)
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
      return toWorkspaceSummary(workspace, "OWNER");
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
    return toWorkspaceSummary(membership.workspace, membership.roleCode);
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

    const membership = await this.prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId, userId } }
    });
    return toWorkspaceSummary(result, membership.roleCode);
  }

  public async listProjects(
    workspaceId: string
  ): Promise<readonly ProjectSummary[]> {
    const projects = await this.prisma.project.findMany({
      where: {
        workspaceId,
        status: { notIn: ["DELETING", "DELETED"] }
      },
      orderBy: { createdAt: "asc" },
      take: 1_000
    });
    return projects.map(toProjectSummary);
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
            createdBy: userId
          }
        });
        await this.audit.record(
          {
            actorId: userId,
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
      where: { id: projectId }
    });
    if (!project || ["DELETING", "DELETED"].includes(project.status)) {
      throw this.notFound();
    }
    return toProjectSummary(project);
  }

  public async updateProject(
    userId: string,
    projectId: string,
    version: number,
    input: UpdateProjectInput,
    context: RequestContext
  ): Promise<ProjectSummary> {
    const current = await this.prisma.project.findUnique({
      where: { id: projectId }
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
      const project = await transaction.project.findUniqueOrThrow({
        where: { id: projectId }
      });
      await this.audit.record(
        {
          actorId: userId,
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
      return toProjectSummary(project);
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
        where: { id: projectId }
      });
      await this.audit.record(
        {
          actorId: userId,
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
      return toProjectSummary(project);
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
