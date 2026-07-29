import {
  assignableWorkspaceRoleCodes,
  projectAccessLevels,
  type ProjectAccessAssignment,
  type WorkspaceInviteSummary,
  type WorkspaceMemberSummary
} from "@seo-platform/contracts";
import type {
  ProjectMemberAccess,
  User,
  WorkspaceInvite,
  WorkspaceMember
} from "../generated/prisma/client.js";

type MemberWithRelations = WorkspaceMember & {
  readonly user: User;
  readonly projectAccesses: readonly ProjectMemberAccess[];
};

export function toWorkspaceMemberSummary(
  member: MemberWithRelations
): WorkspaceMemberSummary {
  return {
    id: member.id,
    workspaceId: member.workspaceId,
    userId: member.userId,
    email: member.user.emailDisplay,
    displayName: member.user.displayName,
    roleCode: member.roleCode,
    status:
      member.status === "SUSPENDED"
        ? "SUSPENDED"
        : member.status === "REMOVED"
          ? "REMOVED"
          : "ACTIVE",
    allProjects: member.allProjects,
    projectAccesses: member.projectAccesses.map(({ projectId, level }) => ({
      projectId,
      level
    })),
    version: member.version,
    ...(member.joinedAt
      ? { joinedAt: member.joinedAt.toISOString() }
      : {})
  };
}

export function toWorkspaceInviteSummary(
  invite: WorkspaceInvite
): WorkspaceInviteSummary {
  if (
    !assignableWorkspaceRoleCodes.includes(
      invite.roleCode as (typeof assignableWorkspaceRoleCodes)[number]
    )
  ) {
    throw new Error(`Unsupported invite role: ${invite.roleCode}`);
  }

  return {
    id: invite.id,
    workspaceId: invite.workspaceId,
    email: invite.emailDisplay,
    roleCode:
      invite.roleCode as (typeof assignableWorkspaceRoleCodes)[number],
    status: invite.status,
    allProjects: invite.allProjects,
    projectAccesses: storedProjectAccesses(invite.projectAccesses),
    ...(invite.message ? { message: invite.message } : {}),
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString()
  };
}

export function storedProjectAccesses(
  value: unknown
): readonly ProjectAccessAssignment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("projectId" in item) ||
      !("level" in item) ||
      typeof item.projectId !== "string" ||
      typeof item.level !== "string" ||
      !projectAccessLevels.includes(
        item.level as (typeof projectAccessLevels)[number]
      )
    ) {
      return [];
    }
    return [
      {
        projectId: item.projectId,
        level: item.level as (typeof projectAccessLevels)[number]
      }
    ];
  });
}
