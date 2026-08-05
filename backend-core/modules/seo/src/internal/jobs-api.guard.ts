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
import {
  internalTokensEqual,
  singleServiceTokenHeader
} from "./internal-token.js";

@Injectable()
export class JobsApiGuard implements CanActivate {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const expected = this.config.jobsApiToken;
    if (!expected) {
      throw new ServiceUnavailableException(
        "Jobs API authentication is not configured"
      );
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const provided = singleServiceTokenHeader(
      request,
      "x-internal-token"
    );
    if (!provided || !internalTokensEqual(expected, provided)) {
      throw new UnauthorizedException("Jobs API authentication failed");
    }
    return true;
  }
}
