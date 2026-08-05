import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { AuthEmailDeliveryController } from "./auth-email-delivery.controller.js";
import { AuthEmailDeliveryGuard } from "./auth-email-delivery.guard.js";
import { AuthEmailDeliveryService } from "./auth-email-delivery.service.js";

@Module({
  imports: [BillingModule, IdentityModule],
  controllers: [AuthEmailDeliveryController],
  providers: [AuthEmailDeliveryGuard, AuthEmailDeliveryService]
})
export class AuthEmailDeliveryModule {}
