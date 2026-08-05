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
} from "./service-token.js";

@Injectable()
export class PlatformApiGuard implements CanActivate {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const expected = this.config.platformApiToken;
    if (!expected) {
      throw new ServiceUnavailableException(
        "Platform API authentication is not configured"
      );
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const provided = singleServiceTokenHeader(
      request,
      "x-internal-token"
    );
    if (!provided || !internalTokensEqual(expected, provided)) {
      throw new UnauthorizedException(
        "Platform API authentication failed"
      );
    }
    return true;
  }
}
