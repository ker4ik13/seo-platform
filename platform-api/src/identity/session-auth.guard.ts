import {
  Injectable,
  type CanActivate,
  type ExecutionContext
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { SessionService } from "./session.service.js";
import { SessionCookieService } from "./session-cookie.service.js";
import type { AuthenticatedRequest } from "./identity.types.js";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  public constructor(
    protected readonly sessions: SessionService,
    protected readonly cookies: SessionCookieService
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
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
    private readonly cookies: SessionCookieService
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
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

export function headerValue(
  request: FastifyRequest,
  name: string
): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}
