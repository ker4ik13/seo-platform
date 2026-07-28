import {
  Injectable,
  type CanActivate,
  type ExecutionContext
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DomainError } from "../common/domain-error.js";
import type { TenantRequest } from "./authorization.types.js";
import { AuthorizationService } from "./authorization.service.js";
import type { Permission } from "./permissions.js";
import { REQUIRED_PERMISSION } from "./require-permission.js";

@Injectable()
export class TenantPermissionGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<Permission>(
      REQUIRED_PERMISSION,
      [context.getHandler(), context.getClass()]
    );
    if (!permission) {
      throw new Error("TenantPermissionGuard requires @RequirePermission");
    }

    const request = context.switchToHttp().getRequest<TenantRequest>();
    if (!request.principal) {
      throw new DomainError({
        statusCode: 401,
        code: "UNAUTHENTICATED",
        message: "Authentication required"
      });
    }

    const params = request.params as Readonly<Record<string, unknown>>;
    const projectId =
      typeof params.projectId === "string" ? params.projectId : undefined;
    const workspaceId =
      typeof params.workspaceId === "string" ? params.workspaceId : undefined;

    if (projectId) {
      request.tenantAuthorization = await this.authorization.forProject(
        request.principal.userId,
        projectId,
        permission
      );
      return true;
    }
    if (workspaceId) {
      request.tenantAuthorization = await this.authorization.forWorkspace(
        request.principal.userId,
        workspaceId,
        permission
      );
      return true;
    }

    throw new Error("Tenant route must contain workspaceId or projectId");
  }
}
