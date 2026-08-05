import { Module } from "@nestjs/common";
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
import { BillingWebhookController } from "./billing-webhook.controller.js";
import { YookassaClient } from "./yookassa.client.js";

@Module({
  imports: [AuditModule, IdentityModule],
  controllers: [
    BillingCatalogController,
    BillingController,
    BillingWebhookController
  ],
  providers: [
    BillingEntitlementService,
    BillingLedgerService,
    BillingPiiService,
    BillingReconciliationService,
    BillingService,
    YookassaClient
  ],
  exports: [BillingEntitlementService, BillingPiiService, BillingService]
})
export class BillingModule {}
