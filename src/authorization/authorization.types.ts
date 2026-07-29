import type { AuthenticatedRequest } from "../identity/identity.types.js";

export type AuthorizedWorkspaceStatus = "ACTIVE" | "READ_ONLY";
export type AuthorizedProjectStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface TenantAuthorization {
  readonly workspaceId: string;
  readonly workspaceStatus: AuthorizedWorkspaceStatus;
  readonly projectId?: string;
  readonly projectStatus?: AuthorizedProjectStatus;
  readonly roleCode: string;
  readonly projectAccessLevel?: "VIEWER" | "MEMBER" | "MANAGER";
  readonly membershipId?: string;
  readonly membershipVersion?: number;
}

export type TenantRequest = AuthenticatedRequest & {
  tenantAuthorization?: TenantAuthorization;
};
