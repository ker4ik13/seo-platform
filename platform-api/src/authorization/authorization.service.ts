import { Injectable } from "@nestjs/common";
import { DomainError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import { PrismaService } from "../database/prisma.service.js";
import type {
  AuthorizedProjectStatus,
  AuthorizedWorkspaceStatus,
  TenantAuthorization
} from "./authorization.types.js";
import {
  hasProjectAccessPermission,
  hasSystemPermission,
  isReadOnlySafePermission,
  type Permission
} from "./permissions.js";

@Injectable()
export class AuthorizationService {
  public constructor(private readonly prisma: PrismaService) {}

  public async forWorkspace(
    userId: string,
    workspaceId: string,
    permission: Permission
  ): Promise<TenantAuthorization> {
    const canonicalWorkspaceId = assertUuid(workspaceId, "workspaceId");
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: canonicalWorkspaceId,
          userId
        }
      },
      include: { workspace: true }
    });
    if (
      !membership ||
      membership.status !== "ACTIVE" ||
      ["DELETING", "DELETED"].includes(membership.workspace.status)
    ) {
      throw this.notFound();
    }
    if (membership.workspace.status === "SUSPENDED") {
      throw new DomainError({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "Workspace access is suspended"
      });
    }
    this.assertWritable(membership.workspace.status, permission);
    if (!hasSystemPermission(membership.roleCode, permission)) {
      throw this.forbidden(permission);
    }
    return {
      workspaceId: membership.workspace.id,
      workspaceStatus: authorizedWorkspaceStatus(
        membership.workspace.status
      ),
      roleCode: membership.roleCode
    };
  }

  public async forProject(
    userId: string,
    projectId: string,
    permission: Permission
  ): Promise<TenantAuthorization> {
    const canonicalProjectId = assertUuid(projectId, "projectId");
    const project = await this.prisma.project.findUnique({
      where: { id: canonicalProjectId }
    });
    if (
      !project ||
      ["DELETING", "DELETED"].includes(project.status)
    ) {
      throw this.notFound();
    }
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: project.workspaceId,
          userId
        }
      },
      include: {
        workspace: true,
        projectAccesses: {
          where: { projectId: project.id },
          take: 1
        }
      }
    });
    if (
      !membership ||
      membership.status !== "ACTIVE" ||
      ["DELETING", "DELETED"].includes(membership.workspace.status)
    ) {
      throw this.notFound();
    }
    if (membership.workspace.status === "SUSPENDED") {
      throw new DomainError({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "Workspace access is suspended"
      });
    }
    this.assertWritable(membership.workspace.status, permission);
    if (!hasSystemPermission(membership.roleCode, permission)) {
      throw this.forbidden(permission);
    }

    const projectAccess = membership.projectAccesses[0];
    if (
      projectAccess?.level === "NONE" ||
      (!membership.allProjects && !projectAccess)
    ) {
      throw this.notFound();
    }
    if (
      projectAccess &&
      !hasProjectAccessPermission(projectAccess.level, permission)
    ) {
      throw this.forbidden(permission);
    }

    return {
      workspaceId: project.workspaceId,
      workspaceStatus: authorizedWorkspaceStatus(
        membership.workspace.status
      ),
      projectId: project.id,
      projectStatus: authorizedProjectStatus(project.status),
      roleCode: membership.roleCode,
      membershipId: membership.id,
      membershipVersion: membership.version,
      ...(projectAccess
        ? { projectAccessLevel: projectAccess.level }
        : {})
    };
  }

  private forbidden(permission: Permission): DomainError {
    return new DomainError({
      statusCode: 403,
      code: "FORBIDDEN",
      message: "Required permission is missing",
      details: { permission }
    });
  }

  private assertWritable(
    workspaceStatus: string,
    permission: Permission
  ): void {
    if (
      workspaceStatus === "READ_ONLY" &&
      !isReadOnlySafePermission(permission)
    ) {
      throw new DomainError({
        statusCode: 402,
        code: "PAYMENT_REQUIRED",
        message:
          "Workspace is read-only; existing results remain available",
        details: { permission, workspaceStatus }
      });
    }
  }

  private notFound(): DomainError {
    return new DomainError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Resource not found"
    });
  }
}

function authorizedWorkspaceStatus(
  status: string
): AuthorizedWorkspaceStatus {
  if (status === "ACTIVE" || status === "READ_ONLY") return status;
  throw new Error("Unauthorized workspace status reached tenant context");
}

function authorizedProjectStatus(status: string): AuthorizedProjectStatus {
  if (
    status === "DRAFT" ||
    status === "ACTIVE" ||
    status === "ARCHIVED"
  ) {
    return status;
  }
  throw new Error("Unauthorized project status reached tenant context");
}
