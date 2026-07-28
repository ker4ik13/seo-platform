import {
  createParamDecorator,
  type ExecutionContext
} from "@nestjs/common";
import { DomainError } from "../common/domain-error.js";
import type {
  AuthenticatedPrincipal,
  AuthenticatedRequest
} from "./identity.types.js";

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal) {
      throw new DomainError({
        statusCode: 401,
        code: "UNAUTHENTICATED",
        message: "Authentication required"
      });
    }
    return request.principal;
  }
);
