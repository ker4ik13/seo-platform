import { createHash, timingSafeEqual } from "node:crypto";
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

@Injectable()
export class InternalApiGuard implements CanActivate {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const expected = this.config.internalApiToken;
    if (!expected) {
      throw new ServiceUnavailableException(
        "Internal API authentication is not configured"
      );
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const provided = request.headers["x-internal-token"];
    if (
      typeof provided !== "string" ||
      !tokensEqual(expected, provided)
    ) {
      throw new UnauthorizedException("Internal authentication failed");
    }
    return true;
  }
}

function tokensEqual(expected: string, provided: string): boolean {
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(provided).digest();
  return timingSafeEqual(left, right);
}
