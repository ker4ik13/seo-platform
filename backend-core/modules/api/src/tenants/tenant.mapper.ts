import type {
  ProjectAccessLevel,
  ProjectSummary,
  WorkspaceSummary
} from "@seo-platform/contracts";
import type {
  Project,
  User,
  Workspace
} from "../generated/prisma/client.js";

export function toWorkspaceSummary(
  workspace: Workspace,
  roleCode: string,
  owner: Pick<User, "id" | "emailDisplay" | "displayName">
): WorkspaceSummary {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    ...(workspace.country ? { country: workspace.country } : {}),
    locale: workspace.locale,
    timezone: workspace.timezone,
    billingCurrency: workspace.billingCurrency,
    status:
      workspace.status === "READ_ONLY"
        ? "READ_ONLY"
        : workspace.status === "SUSPENDED"
          ? "SUSPENDED"
          : "ACTIVE",
    roleCode,
    owner: {
      userId: owner.id,
      email: owner.emailDisplay,
      displayName: owner.displayName
    },
    ...(workspace.avatarUpdatedAt
      ? { avatarUpdatedAt: workspace.avatarUpdatedAt.toISOString() }
      : {}),
    version: workspace.version,
    createdAt: workspace.createdAt.toISOString()
  };
}

export function toProjectSummary(
  project: Project,
  projectAccessLevel?: ProjectAccessLevel,
  logo?: Readonly<{
    source: string | null;
    imageUpdatedAt: Date | null;
  }> | null
): ProjectSummary {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    slug: project.slug,
    domain: project.domain,
    locale: project.locale,
    timezone: project.timezone,
    status:
      project.status === "ARCHIVED"
        ? "ARCHIVED"
        : project.status === "ACTIVE"
          ? "ACTIVE"
          : "DRAFT",
    ownerUserId: project.ownerUserId,
    ...(logo?.source === "CUSTOM" || logo?.source === "DISCOVERED"
      ? { logoSource: logo.source }
      : {}),
    ...(logo?.imageUpdatedAt
      ? { logoUpdatedAt: logo.imageUpdatedAt.toISOString() }
      : {}),
    ...(projectAccessLevel ? { projectAccessLevel } : {}),
    version: project.version,
    createdAt: project.createdAt.toISOString()
  };
}
