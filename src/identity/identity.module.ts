import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { AuthCryptoService } from "./auth-crypto.service.js";
import { AuthRateLimitService } from "./auth-rate-limit.service.js";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";
import {
  CsrfSessionGuard,
  SessionAuthGuard
} from "./session-auth.guard.js";
import { SessionCookieService } from "./session-cookie.service.js";
import { SessionService } from "./session.service.js";

@Module({
  imports: [AuditModule, OutboxModule],
  controllers: [IdentityController],
  providers: [
    AuthCryptoService,
    AuthRateLimitService,
    IdentityService,
    SessionService,
    SessionCookieService,
    SessionAuthGuard,
    CsrfSessionGuard
  ],
  exports: [
    IdentityService,
    SessionService,
    SessionAuthGuard,
    CsrfSessionGuard
  ]
})
export class IdentityModule {}
