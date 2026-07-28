const INTEGRATION_VIEW_ROLES = new Set([
  "OWNER",
  "ADMIN",
  "SEO_LEAD",
  "SEO_SPECIALIST"
]);

const INTEGRATION_MANAGE_ROLES = new Set(["OWNER", "ADMIN"]);

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
