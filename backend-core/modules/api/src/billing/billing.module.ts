import { NpdProcessingService } from "../npd/npd-processing.service.js";
import { BillingNoticeService } from "./billing-notice.service.js";
import { RefundRequestService } from "./refund-request.service.js";
import { ProviderBalanceService } from "./provider-balance.service.js";
import { OperationBillingService } from "./operation-billing.service.js";
import { OperationEstimateController, OperationBillingController } from "./operation-billing.controller.js";
import { RankExecutionGrantSettlementGuard } from "../rankings/rank-execution-grant-settlement.guard.js";
import { NpdProcessingController, NpdProcessingGuard } from "../npd/npd-processing.controller.js";
import { CryptoPayClient } from "./crypto-pay.client.js";
import { CryptoPayWebhookController } from "./crypto-pay-webhook.controller.js";
import { Module } from "@nestjs/common";
import { JobsModule } from "../jobs/jobs.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { WorkspaceUsageService } from "./workspace-usage.service.js";
import { AuditModule } from "../audit/audit.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import {
  BillingCatalogController,
  BillingController
} from "./billing.controller.js";
import { BillingEntitlementService } from "./billing-entitlement.service.js";
import { BillingLedgerService } from "./billing-ledger.service.js";
import { BillingPiiService } from "./billing-pii.service.js";
import { BillingReconciliationService } from "./billing-reconciliation.service.js";
import { BillingService } from "./billing.service.js";
import { BillingUsageService } from "./billing-usage.service.js";
import { BillingWebhookController } from "./billing-webhook.controller.js";
import { YookassaClient } from "./yookassa.client.js";

@Module({
  imports: [AuditModule, IdentityModule, JobsModule, SeoDataModule],
  controllers: [
    OperationEstimateController,
    OperationBillingController,
    BillingCatalogController,
    BillingController,
    BillingWebhookController,
    CryptoPayWebhookController,
    NpdProcessingController
  ],
  providers: [
    BillingNoticeService,
    ProviderBalanceService,
    RefundRequestService,
    OperationBillingService,
    RankExecutionGrantSettlementGuard,
    WorkspaceUsageService,
    BillingEntitlementService,
    BillingLedgerService,
    BillingPiiService,
    BillingReconciliationService,
    BillingService,
    BillingUsageService,
    YookassaClient,
    CryptoPayClient,
    NpdProcessingService,
    NpdProcessingGuard
  ],
  exports: [
    BillingNoticeService,
    ProviderBalanceService,
    RefundRequestService,
    OperationBillingService,
    BillingEntitlementService,
    BillingPiiService,
    BillingService,
    BillingUsageService
  ]
})
export class BillingModule {}
