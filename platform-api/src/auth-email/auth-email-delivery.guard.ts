import { createHash, timingSafeEqual } from "node:crypto";
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { authEmailBearerToken } from "./auth-email-delivery-input.js";

@Injectable()
export class AuthEmailDeliveryGuard implements CanActivate {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    http.getResponse<FastifyReply>().header("Cache-Control", "no-store");
    const expected = this.config.authEmailApiToken;
    if (!expected) {
      throw new ServiceUnavailableException(
        "Auth-email delivery authentication is not configured"
      );
    }
    const provided = authEmailBearerToken(
      http.getRequest<FastifyRequest>()
    );
    if (!provided || !authEmailTokensEqual(expected, provided)) {
      throw new UnauthorizedException(
        "Auth-email delivery authentication failed"
      );
    }
    return true;
  }
}

export function authEmailTokensEqual(
  expected: string,
  provided: string
): boolean {
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(provided).digest();
  return timingSafeEqual(left, right);
}
