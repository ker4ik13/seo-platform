import {
  Injectable,
  type CanActivate,
  type ExecutionContext
} from "@nestjs/common";
import { DomainError } from "../common/domain-error.js";
import type { AuthenticatedRequest } from "./identity.types.js";

/**
 * Marks and protects routes that intentionally accept only a personal API
 * token and derive their tenant scope from that token rather than URL params.
 */
@Injectable()
export class ApiTokenOnlyGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal || !request.apiTokenAuthorization) {
      throw new DomainError({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "This endpoint requires an API token"
      });
    }
    return true;
  }
}
