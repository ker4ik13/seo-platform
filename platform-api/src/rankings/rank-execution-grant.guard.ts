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
import { rankExecutionGrantSingleHeader } from "./rank-execution-grant-input.js";

@Injectable()
export class RankExecutionGrantGuard implements CanActivate {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    http
      .getResponse<FastifyReply>()
      .header("Cache-Control", "no-store");
    const expected = this.config.rankExecutionGrantApiToken;
    if (!expected) {
      throw new ServiceUnavailableException(
        "Rank execution grant authentication is not configured"
      );
    }
    const request = http.getRequest<FastifyRequest>();
    const provided = rankExecutionGrantSingleHeader(
      request,
      "x-rank-grant-token"
    );
    if (
      typeof provided !== "string" ||
      !rankGrantTokensEqual(expected, provided)
    ) {
      throw new UnauthorizedException(
        "Rank execution grant authentication failed"
      );
    }
    return true;
  }
}

export function rankGrantTokensEqual(
  expected: string,
  provided: string
): boolean {
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(provided).digest();
  return timingSafeEqual(left, right);
}
