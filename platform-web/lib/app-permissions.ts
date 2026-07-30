import type { ProjectAccessLevel } from "@seo-platform/contracts";

const INTEGRATION_VIEW_ROLES = new Set([
  "OWNER",
  "ADMIN",
  "SEO_LEAD",
  "SEO_SPECIALIST"
]);

const INTEGRATION_MANAGE_ROLES = new Set(["OWNER", "ADMIN"]);
const WORKSPACE_UPDATE_ROLES = new Set(["OWNER", "ADMIN"]);
const PROJECT_UPDATE_ROLES = new Set([
  "OWNER",
  "ADMIN",
  "SEO_LEAD",
  "SEO_SPECIALIST"
]);
const PROJECT_ARCHIVE_ROLES = new Set(["OWNER", "ADMIN", "SEO_LEAD"]);
const PROJECT_RESTORE_ROLES = new Set(["OWNER", "ADMIN"]);

type EffectiveProjectPermission =
  | "integration.view"
  | "project.update"
  | "project.archive"
  | "project.restore";

const PROJECT_PERMISSION_ROLES: Readonly<
  Record<EffectiveProjectPermission, ReadonlySet<string>>
> = {
  "integration.view": INTEGRATION_VIEW_ROLES,
  "project.update": PROJECT_UPDATE_ROLES,
  "project.archive": PROJECT_ARCHIVE_ROLES,
  "project.restore": PROJECT_RESTORE_ROLES
};

export function canViewWorkspaceIntegrations(
  roleCode: string | undefined
): boolean {
  return Boolean(roleCode && INTEGRATION_VIEW_ROLES.has(roleCode));
}

export function canManageWorkspaceIntegrations(
  roleCode: string | undefined
): boolean {
  return Boolean(roleCode && INTEGRATION_MANAGE_ROLES.has(roleCode));
}

export function canTestWorkspaceIntegrations(
  roleCode: string | undefined
): boolean {
  return canViewWorkspaceIntegrations(roleCode);
}

export function canUpdateWorkspace(
  roleCode: string | undefined
): boolean {
  return Boolean(roleCode && WORKSPACE_UPDATE_ROLES.has(roleCode));
}

export function canUpdateProject(
  roleCode: string | undefined,
  projectAccessLevel?: ProjectAccessLevel
): boolean {
  return hasEffectiveProjectPermission(
    roleCode,
    projectAccessLevel,
    "project.update"
  );
}

export function canArchiveProject(
  roleCode: string | undefined,
  projectAccessLevel?: ProjectAccessLevel
): boolean {
  return hasEffectiveProjectPermission(
    roleCode,
    projectAccessLevel,
    "project.archive"
  );
}

export function canRestoreProject(
  roleCode: string | undefined,
  projectAccessLevel?: ProjectAccessLevel
): boolean {
  return hasEffectiveProjectPermission(
    roleCode,
    projectAccessLevel,
    "project.restore"
  );
}

export function canViewProjectIntegrations(
  roleCode: string | undefined,
  projectAccessLevel?: ProjectAccessLevel
): boolean {
  return hasEffectiveProjectPermission(
    roleCode,
    projectAccessLevel,
    "integration.view"
  );
}

export function hasEffectiveProjectPermission(
  roleCode: string | undefined,
  projectAccessLevel: ProjectAccessLevel | undefined,
  permission: EffectiveProjectPermission
): boolean {
  if (!roleCode || !PROJECT_PERMISSION_ROLES[permission].has(roleCode)) {
    return false;
  }
  return projectAccessLevel === undefined || projectAccessLevel === "MANAGER";
}
