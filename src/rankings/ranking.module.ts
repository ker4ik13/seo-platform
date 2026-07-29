import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { TenantModule } from "../tenants/tenant.module.js";
import { RankEstimateController } from "./rank-estimate.controller.js";
import { TrackingContextController } from "./tracking-context.controller.js";

@Module({
  imports: [
    AuthorizationModule,
    IdentityModule,
    JobsModule,
    SeoDataModule,
    TenantModule
  ],
  controllers: [RankEstimateController, TrackingContextController]
})
export class RankingModule {}
