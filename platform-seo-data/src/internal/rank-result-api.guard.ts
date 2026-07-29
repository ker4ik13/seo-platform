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
 * Dedicated write boundary for normalized rank results. Preparation workers
 * can read manifest text but cannot persist observations, while result
 * workers can persist only already-normalized data and never read plaintext
 * keyword chunks through this credential.
 */
@Injectable()
export class RankResultApiGuard implements CanActivate {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const expected = this.config.jobsToSeoRankResultToken;
    if (!expected) {
      throw new ServiceUnavailableException(
        "Rank result authentication is not configured"
      );
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const provided = request.headers["x-rank-result-token"];
    if (
      typeof provided !== "string" ||
      !internalTokensEqual(expected, provided)
    ) {
      throw new UnauthorizedException(
        "Rank result authentication failed"
      );
    }
    return true;
  }
}
