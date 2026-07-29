import { Inject, Injectable } from "@nestjs/common";
import { DomainError } from "../common/domain-error.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import type { AuthenticatedPrincipal } from "./identity.types.js";

@Injectable()
export class RecentAuthenticationService {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public assert(principal: AuthenticatedPrincipal): void {
    const oldestAllowed =
      Date.now() -
      this.config.auth.recentAuthenticationMinutes * 60 * 1_000;
    if (principal.authenticatedAt.getTime() < oldestAllowed) {
      throw new DomainError({
        statusCode: 401,
        code: "REAUTHENTICATION_REQUIRED",
        message: "Recent authentication is required"
      });
    }
  }
}
