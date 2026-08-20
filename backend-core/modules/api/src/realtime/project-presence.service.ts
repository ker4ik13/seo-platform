import { Injectable } from "@nestjs/common";
import {
  projectPresenceMaximumMembers,
  type ProjectPresenceMember
} from "@seo-platform/contracts";
import { assertUuid } from "../common/identifier.js";
import { DomainError } from "../common/domain-error.js";
import { PrismaService } from "../database/prisma.service.js";

interface ProjectPresenceAvatar {
  readonly contentType: string;
  readonly data: Buffer;
  readonly updatedAt: Date;
}

@Injectable()
export class ProjectPresenceService {
  public constructor(private readonly prisma: PrismaService) {}

  public async listMembers(
    workspaceId: string,
    projectId: string
  ): Promise<readonly ProjectPresenceMember[]> {
    const scope = projectMemberScope(workspaceId, projectId);
    const members = await this.prisma.workspaceMember.findMany({
      where: scope,
      select: {
        userId: true,
        user: {
          select: {
            displayName: true,
            avatarUpdatedAt: true
          }
        }
      },
      orderBy: [{ user: { displayName: "asc" } }, { id: "asc" }],
      take: projectPresenceMaximumMembers
    });
    return members.map((member) => ({
      userId: member.userId,
      displayName: member.user.displayName,
      ...(member.user.avatarUpdatedAt
        ? { avatarUpdatedAt: member.user.avatarUpdatedAt.toISOString() }
        : {})
    }));
  }

  public async getMemberAvatar(
    workspaceId: string,
    projectId: string,
    userId: string
  ): Promise<ProjectPresenceAvatar> {
    const normalizedUserId = assertUuid(userId, "userId");
    const member = await this.prisma.workspaceMember.findFirst({
      where: {
        ...projectMemberScope(workspaceId, projectId),
        userId: normalizedUserId
      },
      select: {
        user: {
          select: {
            avatarMimeType: true,
            avatarData: true,
            avatarUpdatedAt: true
          }
        }
      }
    });
    const avatar = member?.user;
    if (
      !avatar?.avatarMimeType ||
      !avatar.avatarData ||
      !avatar.avatarUpdatedAt
    ) {
      throw new DomainError({
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Project member avatar not found"
      });
    }
    return {
      contentType: avatar.avatarMimeType,
      data: Buffer.from(avatar.avatarData),
      updatedAt: avatar.avatarUpdatedAt
    };
  }
}

function projectMemberScope(workspaceId: string, projectId: string) {
  const normalizedWorkspaceId = assertUuid(workspaceId, "workspaceId");
  const normalizedProjectId = assertUuid(projectId, "projectId");
  return {
    workspaceId: normalizedWorkspaceId,
    status: "ACTIVE" as const,
    user: { status: "ACTIVE" as const },
    OR: [
      { allProjects: true },
      {
        projectAccesses: {
          some: {
            projectId: normalizedProjectId,
            level: { not: "NONE" as const }
          }
        }
      }
    ]
  };
}
