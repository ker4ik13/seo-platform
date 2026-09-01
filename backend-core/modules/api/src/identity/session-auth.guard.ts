import {
  Injectable,
  type CanActivate,
  type ExecutionContext
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import type { FastifyRequest } from "fastify";
import { DomainError } from "../common/domain-error.js";
import { REQUIRED_PERMISSION } from "../authorization/require-permission.js";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard.js";
import { ApiTokenAuthenticationService } from "./api-token-authentication.service.js";
import { SessionService } from "./session.service.js";
import { SessionCookieService } from "./session-cookie.service.js";
import type { AuthenticatedRequest } from "./identity.types.js";
import { ApiTokenOnlyGuard } from "./api-token-only.guard.js";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  public constructor(
    protected readonly sessions: SessionService,
    protected readonly cookies: SessionCookieService,
    private readonly reflector: Reflector,
    private readonly apiTokens: ApiTokenAuthenticationService
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = headerValue(request, "authorization");
    if (authorization !== undefined) {
      assertTenantApiRoute(this.reflector, context);
      const authenticated = await this.apiTokens.authenticate(authorization);
      request.principal = authenticated.principal;
      request.apiTokenAuthorization = authenticated.authorization;
      return true;
    }
    const authenticated = await this.sessions.authenticate(
      this.cookies.accessToken(request.cookies)
    );
    request.principal = authenticated.principal;
    return true;
  }
}

@Injectable()
export class CsrfSessionGuard implements CanActivate {
  public constructor(
    private readonly sessions: SessionService,
    private readonly cookies: SessionCookieService,
    private readonly reflector: Reflector,
    private readonly apiTokens: ApiTokenAuthenticationService
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = headerValue(request, "authorization");
    if (authorization !== undefined) {
      assertTenantApiRoute(this.reflector, context);
      const authenticated = await this.apiTokens.authenticate(authorization);
      request.principal = authenticated.principal;
      request.apiTokenAuthorization = authenticated.authorization;
      return true;
    }
    const csrfHeader = headerValue(request, "x-csrf-token");
    const authenticated = await this.sessions.authenticate(
      this.cookies.accessToken(request.cookies),
      this.cookies.csrfToken(request.cookies),
      csrfHeader
    );
    request.principal = authenticated.principal;
    return true;
  }
}

function assertTenantApiRoute(
  reflector: Reflector,
  context: ExecutionContext
): void {
  const permission = reflector.getAllAndOverride<string>(
    REQUIRED_PERMISSION,
    [context.getHandler(), context.getClass()]
  );
  const guards = [
    ...metadataGuards(context.getClass()),
    ...metadataGuards(context.getHandler())
  ];
  if (guards.includes(ApiTokenOnlyGuard)) return;
  if (permission && guards.includes(TenantPermissionGuard)) return;
  throw new DomainError({
    statusCode: 403,
    code: "FORBIDDEN",
    message: "API tokens are not supported for this endpoint"
  });
}

function metadataGuards(target: object): readonly unknown[] {
  const value: unknown = Reflect.getMetadata(GUARDS_METADATA, target);
  return Array.isArray(value) ? value : [];
}

export function headerValue(
  request: FastifyRequest,
  name: string
): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}
