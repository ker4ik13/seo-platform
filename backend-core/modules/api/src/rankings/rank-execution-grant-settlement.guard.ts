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
import { rankGrantTokensEqual } from "./rank-execution-grant.guard.js";
import { rankExecutionGrantSingleHeader } from "./rank-execution-grant-input.js";

@Injectable()
export class RankExecutionGrantSettlementGuard implements CanActivate {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    http
      .getResponse<FastifyReply>()
      .header("Cache-Control", "no-store");
    const expected = this.config.rankBillingSettlementApiToken;
    if (!expected) {
      throw new ServiceUnavailableException(
        "Rank billing settlement authentication is not configured"
      );
    }
    const provided = rankExecutionGrantSingleHeader(
      http.getRequest<FastifyRequest>(),
      "x-rank-billing-settlement-token"
    );
    if (
      typeof provided !== "string" ||
      !rankGrantTokensEqual(expected, provided)
    ) {
      throw new UnauthorizedException(
        "Rank billing settlement authentication failed"
      );
    }
    return true;
  }
}
