import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { TeamController } from "./team.controller.js";
import { TeamService } from "./team.service.js";
import { ProjectTransferController } from "./project-transfer.controller.js";
import { ProjectTransferService } from "./project-transfer.service.js";
import { ProjectLogoService } from "./project-logo.service.js";
import { TenantController } from "./tenant.controller.js";
import { TenantService } from "./tenant.service.js";

@Module({
  imports: [
    IdentityModule,
    AuthorizationModule,
    BillingModule,
    JobsModule,
    SeoDataModule
  ],
  controllers: [TenantController, TeamController, ProjectTransferController],
  providers: [
    TenantService,
    TeamService,
    ProjectTransferService,
    ProjectLogoService
  ],
  exports: [TenantService, TeamService, ProjectTransferService]
})
export class TenantModule {}
