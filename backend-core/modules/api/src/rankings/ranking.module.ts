import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { TenantModule } from "../tenants/tenant.module.js";
import { RankExecutionGrantController } from "./rank-execution-grant.controller.js";
import { RankExecutionGrantSettlementController } from "./rank-execution-grant-settlement.controller.js";
import { RankExecutionGrantSettlementGuard } from "./rank-execution-grant-settlement.guard.js";
import { RankExecutionGrantSettlementService } from "./rank-execution-grant-settlement.service.js";
import { RankExecutionGrantGuard } from "./rank-execution-grant.guard.js";
import {
  ControlledBetaRankExecutionGrantPolicy,
  RANK_EXECUTION_GRANT_POLICY
} from "./rank-execution-grant.policy.js";
import { RankExecutionGrantService } from "./rank-execution-grant.service.js";
import { RankEstimateController } from "./rank-estimate.controller.js";
import { RankHistoryController } from "./rank-history.controller.js";
import { RankRunController } from "./rank-run.controller.js";
import { TrackingContextController } from "./tracking-context.controller.js";
import { AutomationController } from "./automation.controller.js";

@Module({
  imports: [
    AuthorizationModule,
    BillingModule,
    IdentityModule,
    JobsModule,
    SeoDataModule,
    TenantModule
  ],
  controllers: [
    AutomationController,
    RankExecutionGrantController,
    RankExecutionGrantSettlementController,
    RankEstimateController,
    RankHistoryController,
    RankRunController,
    TrackingContextController
  ],
  providers: [
    ControlledBetaRankExecutionGrantPolicy,
    RankExecutionGrantGuard,
    RankExecutionGrantSettlementGuard,
    RankExecutionGrantService,
    RankExecutionGrantSettlementService,
    {
      provide: RANK_EXECUTION_GRANT_POLICY,
      useExisting: ControlledBetaRankExecutionGrantPolicy
    }
  ]
})
export class RankingModule {}
