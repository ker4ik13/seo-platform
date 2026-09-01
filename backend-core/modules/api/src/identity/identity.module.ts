import { Logger, Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { AuthCryptoService } from "./auth-crypto.service.js";
import { AuthRateLimitService } from "./auth-rate-limit.service.js";
import { ApiTokenAuthenticationService } from "./api-token-authentication.service.js";
import { ApiTokenOnlyGuard } from "./api-token-only.guard.js";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";
import { MfaController } from "./mfa.controller.js";
import { MfaService } from "./mfa.service.js";
import { RecentAuthenticationService } from "./recent-authentication.service.js";
import {
  CsrfSessionGuard,
  SessionAuthGuard
} from "./session-auth.guard.js";
import { SessionCookieService } from "./session-cookie.service.js";
import {
  SESSION_EXPIRY_SWEEPER_LOGGER,
  SESSION_EXPIRY_SWEEPER_SCHEDULER,
  SessionExpirySweeperService,
  type SessionExpirySweeperLogger,
  type SessionExpirySweeperScheduler
} from "./session-expiry-sweeper.service.js";
import { SessionService } from "./session.service.js";

const sessionExpirySweeperScheduler: SessionExpirySweeperScheduler = {
  schedule: (task, delayMs) => setTimeout(task, delayMs),
  cancel: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>)
};

@Module({
  imports: [AuditModule, OutboxModule],
  controllers: [IdentityController, MfaController],
  providers: [
    AuthCryptoService,
    AuthRateLimitService,
    ApiTokenAuthenticationService,
    ApiTokenOnlyGuard,
    IdentityService,
    MfaService,
    RecentAuthenticationService,
    SessionService,
    SessionExpirySweeperService,
    {
      provide: SESSION_EXPIRY_SWEEPER_SCHEDULER,
      useValue: sessionExpirySweeperScheduler
    },
    {
      provide: SESSION_EXPIRY_SWEEPER_LOGGER,
      useFactory: (): SessionExpirySweeperLogger => {
        const logger = new Logger(SessionExpirySweeperService.name);
        return { warn: (message) => logger.warn(message) };
      }
    },
    SessionCookieService,
    SessionAuthGuard,
    CsrfSessionGuard
  ],
  exports: [
    IdentityService,
    SessionService,
    AuthCryptoService,
    ApiTokenAuthenticationService,
    ApiTokenOnlyGuard,
    RecentAuthenticationService,
    SessionCookieService,
    SessionAuthGuard,
    CsrfSessionGuard
  ]
})
export class IdentityModule {}
