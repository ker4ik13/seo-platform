import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { internalTokensEqual } from "../internal/internal-api.guard.js";

@Injectable()
export class WebPushApiGuard implements CanActivate {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const expected = this.config.notificationApiToken;
    if (!expected) {
      throw new ServiceUnavailableException({
        code: "WEB_PUSH_UNAVAILABLE",
        message: "Web Push management is not configured"
      });
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const provided = request.headers["x-internal-token"];
    if (
      typeof provided !== "string" ||
      !internalTokensEqual(expected, provided)
    ) {
      throw new UnauthorizedException(
        "Notification API authentication failed"
      );
    }
    return true;
  }
}
