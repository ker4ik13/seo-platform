import type {
  ProjectAccessLevel,
  ProjectSummary,
  WorkspaceSummary
} from "@seo-platform/contracts";
import type {
  Project,
  Workspace
} from "../generated/prisma/client.js";

export function toWorkspaceSummary(
  workspace: Workspace,
  roleCode: string
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
    version: workspace.version,
    createdAt: workspace.createdAt.toISOString()
  };
}

export function toProjectSummary(
  project: Project,
  projectAccessLevel?: ProjectAccessLevel
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
    ...(projectAccessLevel ? { projectAccessLevel } : {}),
    version: project.version,
    createdAt: project.createdAt.toISOString()
  };
}
