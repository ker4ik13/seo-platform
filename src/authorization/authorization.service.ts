import { Injectable } from "@nestjs/common";
import { DomainError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import { PrismaService } from "../database/prisma.service.js";
import type { TenantAuthorization } from "./authorization.types.js";
import {
  hasProjectAccessPermission,
  hasSystemPermission,
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
    assertUuid(workspaceId, "workspaceId");
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
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
    if (!hasSystemPermission(membership.roleCode, permission)) {
      throw this.forbidden(permission);
    }
    return { workspaceId, roleCode: membership.roleCode };
  }

  public async forProject(
    userId: string,
    projectId: string,
    permission: Permission
  ): Promise<TenantAuthorization> {
    assertUuid(projectId, "projectId");
    const project = await this.prisma.project.findUnique({
      where: { id: projectId }
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
          where: { projectId },
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
      projectId,
      roleCode: membership.roleCode,
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

  private notFound(): DomainError {
    return new DomainError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Resource not found"
    });
  }
}
