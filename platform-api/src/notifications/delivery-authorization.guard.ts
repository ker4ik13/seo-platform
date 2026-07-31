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
import { singleDispatchHeader } from "../crawls/crawl-automation-dispatch.input.js";

@Injectable()
export class DeliveryAuthorizationGuard implements CanActivate {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    http.getResponse<FastifyReply>().header("Cache-Control", "no-store");
    const expected = this.config.realtimeDeliveryAuthorizationApiToken;
    if (!expected) {
      throw new ServiceUnavailableException(
        "Notification delivery authorization is not configured"
      );
    }
    const provided = singleDispatchHeader(
      http.getRequest<FastifyRequest>(),
      "x-notification-delivery-token"
    );
    if (!provided || !tokensEqual(expected, provided)) {
      throw new UnauthorizedException(
        "Notification delivery authorization failed"
      );
    }
    return true;
  }
}

function tokensEqual(expected: string, provided: string): boolean {
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(provided).digest();
  return timingSafeEqual(left, right);
}
