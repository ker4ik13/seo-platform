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
import { singleDispatchHeader } from "./crawl-automation-dispatch.input.js";

@Injectable()
export class CrawlAutomationDispatchGuard implements CanActivate {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    http.getResponse<FastifyReply>().header("Cache-Control", "no-store");
    const expected = this.config.automationDispatchApiToken;
    if (!expected) {
      throw new ServiceUnavailableException(
        "Automation dispatch authentication is not configured"
      );
    }
    const provided = singleDispatchHeader(
      http.getRequest<FastifyRequest>(),
      "x-automation-token"
    );
    if (!provided || !tokensEqual(expected, provided)) {
      throw new UnauthorizedException(
        "Automation dispatch authentication failed"
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
