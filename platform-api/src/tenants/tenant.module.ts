import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { TeamController } from "./team.controller.js";
import { TeamService } from "./team.service.js";
import { TenantController } from "./tenant.controller.js";
import { TenantService } from "./tenant.service.js";

@Module({
  imports: [IdentityModule, AuthorizationModule, BillingModule],
  controllers: [TenantController, TeamController],
  providers: [TenantService, TeamService],
  exports: [TenantService, TeamService]
})
export class TenantModule {}
