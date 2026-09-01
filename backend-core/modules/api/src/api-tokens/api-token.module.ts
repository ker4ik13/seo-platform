import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { ApiTokenController } from "./api-token.controller.js";
import { ApiTokenDiscoveryController } from "./api-token-discovery.controller.js";
import { ApiTokenService } from "./api-token.service.js";

@Module({
  imports: [AuditModule, AuthorizationModule, IdentityModule],
  controllers: [ApiTokenController, ApiTokenDiscoveryController],
  providers: [ApiTokenService]
})
export class ApiTokenModule {}
