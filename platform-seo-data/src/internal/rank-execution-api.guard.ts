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
import { internalTokensEqual } from "./internal-token.js";

/**
 * Dedicated secret-bearing boundary for rank workers. The generic internal
 * service token must never authorize plaintext manifest chunk reads.
 */
@Injectable()
export class RankExecutionApiGuard implements CanActivate {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const expected = this.config.jobsToSeoRankToken;
    if (!expected) {
      throw new ServiceUnavailableException(
        "Rank execution authentication is not configured"
      );
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const provided = request.headers["x-rank-execution-token"];
    if (
      typeof provided !== "string" ||
      !internalTokensEqual(expected, provided)
    ) {
      throw new UnauthorizedException(
        "Rank execution authentication failed"
      );
    }
    return true;
  }
}
