import type { AuthenticatedRequest } from "../identity/identity.types.js";

export interface TenantAuthorization {
  readonly workspaceId: string;
  readonly projectId?: string;
  readonly roleCode: string;
}

export type TenantRequest = AuthenticatedRequest & {
  tenantAuthorization?: TenantAuthorization;
};
