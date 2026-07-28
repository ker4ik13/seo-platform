export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly country?: string;
  readonly locale: string;
  readonly timezone: string;
  readonly billingCurrency: string;
  readonly status: "ACTIVE" | "READ_ONLY" | "SUSPENDED";
  readonly roleCode: string;
  readonly version: number;
  readonly createdAt: string;
}

export interface CreateWorkspaceInput {
  readonly name: string;
  readonly slug?: string;
  readonly country?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly billingCurrency: string;
}

export interface UpdateWorkspaceInput {
  readonly name?: string;
  readonly country?: string | null;
  readonly locale?: string;
  readonly timezone?: string;
}

export const assignableWorkspaceRoleCodes = [
  "ADMIN",
  "SEO_LEAD",
  "SEO_SPECIALIST",
  "ANALYST",
  "CONTENT_EDITOR",
  "CLIENT",
  "VIEWER"
] as const;

export type AssignableWorkspaceRoleCode =
  (typeof assignableWorkspaceRoleCodes)[number];

export const projectAccessLevels = [
  "NONE",
  "VIEWER",
  "MEMBER",
  "MANAGER"
] as const;

export type ProjectAccessLevel = (typeof projectAccessLevels)[number];

export interface ProjectAccessAssignment {
  readonly projectId: string;
  readonly level: ProjectAccessLevel;
}

export interface WorkspaceMemberSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly roleCode: string;
  readonly status: "ACTIVE" | "SUSPENDED" | "REMOVED";
  readonly allProjects: boolean;
  readonly projectAccesses: readonly ProjectAccessAssignment[];
  readonly version: number;
  readonly joinedAt?: string;
}

export interface WorkspaceInviteSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly email: string;
  readonly roleCode: AssignableWorkspaceRoleCode;
  readonly status:
    | "SENT"
    | "DELIVERED"
    | "ACCEPTED"
    | "EXPIRED"
    | "REVOKED"
    | "BOUNCED";
  readonly allProjects: boolean;
  readonly projectAccesses: readonly ProjectAccessAssignment[];
  readonly message?: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface CreateWorkspaceInviteInput {
  readonly email: string;
  readonly roleCode: AssignableWorkspaceRoleCode;
  readonly allProjects: boolean;
  readonly projectAccesses: readonly ProjectAccessAssignment[];
  readonly message?: string;
  readonly expiresInDays?: number;
}

export interface CreateWorkspaceInviteResult {
  readonly invite: WorkspaceInviteSummary;
  readonly invitationTokenForDevelopment?: string;
}

export interface AcceptWorkspaceInviteInput {
  readonly token: string;
}

export interface UpdateWorkspaceMemberInput {
  readonly roleCode: AssignableWorkspaceRoleCode;
  readonly allProjects: boolean;
  readonly projectAccesses: readonly ProjectAccessAssignment[];
}

export interface ProjectSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly slug: string;
  readonly domain: string;
  readonly locale: string;
  readonly timezone: string;
  readonly status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  readonly version: number;
  readonly createdAt: string;
}

export interface CreateProjectInput {
  readonly name: string;
  readonly slug?: string;
  readonly domain: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly confirmDuplicateDomain?: boolean;
}

export interface UpdateProjectInput {
  readonly name?: string;
  readonly domain?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly confirmDuplicateDomain?: boolean;
}
