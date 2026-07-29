import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { TenantModule } from "../tenants/tenant.module.js";
import { RankExecutionGrantController } from "./rank-execution-grant.controller.js";
import { RankExecutionGrantGuard } from "./rank-execution-grant.guard.js";
import {
  FailClosedRankExecutionGrantPolicy,
  RANK_EXECUTION_GRANT_POLICY
} from "./rank-execution-grant.policy.js";
import { RankExecutionGrantService } from "./rank-execution-grant.service.js";
import { RankEstimateController } from "./rank-estimate.controller.js";
import { RankHistoryController } from "./rank-history.controller.js";
import { RankRunController } from "./rank-run.controller.js";
import { TrackingContextController } from "./tracking-context.controller.js";

@Module({
  imports: [
    AuthorizationModule,
    IdentityModule,
    JobsModule,
    SeoDataModule,
    TenantModule
  ],
  controllers: [
    RankExecutionGrantController,
    RankEstimateController,
    RankHistoryController,
    RankRunController,
    TrackingContextController
  ],
  providers: [
    FailClosedRankExecutionGrantPolicy,
    RankExecutionGrantGuard,
    RankExecutionGrantService,
    {
      provide: RANK_EXECUTION_GRANT_POLICY,
      useExisting: FailClosedRankExecutionGrantPolicy
    }
  ]
})
export class RankingModule {}
