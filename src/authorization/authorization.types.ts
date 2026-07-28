import type { AuthenticatedRequest } from "../identity/identity.types.js";

export interface TenantAuthorization {
  readonly workspaceId: string;
  readonly projectId?: string;
  readonly roleCode: string;
  readonly projectAccessLevel?: "VIEWER" | "MEMBER" | "MANAGER";
}

export type TenantRequest = AuthenticatedRequest & {
  tenantAuthorization?: TenantAuthorization;
};
