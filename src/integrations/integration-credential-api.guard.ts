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
export class IntegrationCredentialApiGuard implements CanActivate {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    if (this.config.integrationCredentials.role !== "MANAGEMENT") {
      throw new ServiceUnavailableException(
        "Credential management capability is not configured"
      );
    }
    const expected = this.config.integrationCredentialApiToken;
    if (!expected) {
      throw new ServiceUnavailableException(
        "Credential API authentication is not configured"
      );
    }
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const provided = request.headers["x-internal-token"];
    if (
      typeof provided !== "string" ||
      !internalTokensEqual(expected, provided)
    ) {
      throw new UnauthorizedException(
        "Credential API authentication failed"
      );
    }
    return true;
  }
}
