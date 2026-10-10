export interface WorkspaceOwnerSummary {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
}

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
  readonly owner: WorkspaceOwnerSummary;
  readonly avatarUpdatedAt?: string;
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

export interface UpdateWorkspaceAvatarInput {
  readonly contentType: "image/png" | "image/jpeg" | "image/webp";
  readonly data: string;
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
    | "DECLINED"
    | "EXPIRED"
    | "REVOKED"
    | "BOUNCED";
  readonly allProjects: boolean;
  readonly projectAccesses: readonly ProjectAccessAssignment[];
  readonly message?: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface PendingWorkspaceInviteSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly workspaceSlug: string;
  readonly workspaceStatus: "ACTIVE" | "READ_ONLY" | "SUSPENDED";
  readonly roleCode: AssignableWorkspaceRoleCode;
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

export interface WorkspaceTeamListQuery {
  readonly limit: number;
  readonly cursor?: string;
}

export const workspaceInviteListStatuses = ["PENDING", "ALL"] as const;

export type WorkspaceInviteListStatus =
  (typeof workspaceInviteListStatuses)[number];

export interface WorkspaceInviteListQuery extends WorkspaceTeamListQuery {
  readonly status: WorkspaceInviteListStatus;
}

export interface ProjectSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly slug: string;
  readonly domain: string;
  readonly locale: string;
  readonly timezone: string;
  readonly searchCity?: ProjectSearchCity;
  readonly onboarding?: import("./project-onboarding.js").ProjectOnboardingSettings;
  readonly status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  readonly ownerUserId: string;
  readonly logoSource?: "CUSTOM" | "DISCOVERED";
  readonly logoUpdatedAt?: string;
  readonly activeOperationCount?: number;
  readonly projectAccessLevel?: ProjectAccessLevel;
  readonly version: number;
  readonly createdAt: string;
}

export const projectCreationAvailabilityReasons = [
  "AVAILABLE",
  "PERMISSION_REQUIRED",
  "WORKSPACE_READ_ONLY",
  "LIMIT_REACHED"
] as const;

export type ProjectCreationAvailabilityReason =
  (typeof projectCreationAvailabilityReasons)[number];

export interface ProjectCollectionCapabilities {
  readonly creation: {
    readonly allowed: boolean;
    readonly reason: ProjectCreationAvailabilityReason;
    readonly used: number;
    readonly limit: number;
  };
  readonly canReorder: boolean;
}

export interface ReorderProjectsInput {
  /** Exact order last observed by the caller. Used as an optimistic precondition. */
  readonly expectedProjectIds: readonly string[];
  /** Exact complete workspace order requested by the caller. */
  readonly projectIds: readonly string[];
}

export interface ProjectOrderResult {
  readonly projectIds: readonly string[];
}

export interface ProjectSearchCity {
  readonly name: string;
  readonly yandexRegionCode: string;
  readonly googleRegionCode: string;
}

export interface ProjectOperationActivitySummary {
  readonly projectId: string;
  readonly activeOperationCount: number;
}

export interface ProjectOperationActivityCollection {
  readonly projects: readonly ProjectOperationActivitySummary[];
}

export const projectLogoContentTypes = [
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/x-icon",
  "image/gif",
  "image/avif"
] as const;

export type ProjectLogoContentType =
  (typeof projectLogoContentTypes)[number];

export interface UpdateProjectLogoInput {
  readonly contentType: ProjectLogoContentType;
  readonly data: string;
}

export interface DeleteProjectInput {
  /** Exact project name used as a destructive-action confirmation. */
  readonly confirmation: string;
}

export interface ProjectDeletionResult {
  readonly projectId: string;
  readonly status: "DELETED";
  readonly deletedAt: string;
}

export interface CreateProjectTransferInput {
  readonly targetMemberId: string;
}

export interface AcceptProjectTransferInput {
  readonly destinationWorkspaceId: string;
}

export interface InternalProjectWorkspaceTransferInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly destinationWorkspaceId: string;
}

export interface InternalProjectExecutionResetResult {
  readonly status: "RESET";
}

export interface InternalProjectSeoTransferResult {
  readonly status: "TRANSFERRED";
  readonly affectedRows: number;
}

export interface ProjectTransferRequestSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly destinationWorkspaceId?: string;
  readonly destinationWorkspaceName?: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly fromUserId: string;
  readonly fromDisplayName: string;
  readonly toUserId: string;
  readonly toDisplayName: string;
  readonly toEmail: string;
  readonly status: "PENDING" | "PROCESSING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "EXPIRED";
  readonly processingErrorCode?: string;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface CreateProjectInput {
  readonly name: string;
  readonly slug?: string;
  readonly domain: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly searchCity?: ProjectSearchCity;
  readonly onboarding?: import("./project-onboarding.js").ProjectOnboardingSettings;
  readonly confirmDuplicateDomain?: boolean;
}

export interface UpdateProjectInput {
  readonly name?: string;
  readonly domain?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly searchCity?: ProjectSearchCity | null;
  readonly confirmDuplicateDomain?: boolean;
}
