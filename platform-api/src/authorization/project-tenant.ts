import { DomainError } from "../common/domain-error.js";
import type { AuthenticatedPrincipal } from "../identity/identity.types.js";
import { requestContext } from "../identity/request-context.js";
import type {
  TenantAuthorization,
  TenantRequest
} from "./authorization.types.js";

export type AuthorizedProjectTenant = TenantAuthorization & {
  readonly projectId: string;
  readonly projectStatus: NonNullable<
    TenantAuthorization["projectStatus"]
  >;
};

export interface InternalProjectContext {
  readonly tenant: AuthorizedProjectTenant;
  readonly actorId: string;
  readonly requestId: string;
}

export function requiredProjectTenant(
  request: TenantRequest
): AuthorizedProjectTenant {
  const tenant = request.tenantAuthorization;
  if (!tenant?.projectId || !tenant.projectStatus) {
    throw new Error("Project authorization is missing");
  }
  return tenant as AuthorizedProjectTenant;
}

export function requiredMutableProjectTenant(
  request: TenantRequest
): AuthorizedProjectTenant {
  const tenant = requiredProjectTenant(request);
  if (tenant.projectStatus === "ARCHIVED") {
    throw new DomainError({
      statusCode: 409,
      code: "RESOURCE_STATE_CONFLICT",
      message: "Archived projects cannot be changed",
      details: { projectStatus: tenant.projectStatus }
    });
  }
  return tenant;
}

export function internalProjectContext(
  request: TenantRequest,
  principal: AuthenticatedPrincipal,
  tenant: AuthorizedProjectTenant
): InternalProjectContext {
  return {
    tenant,
    actorId: principal.userId,
    requestId: requestContext(request).requestId
  };
}
