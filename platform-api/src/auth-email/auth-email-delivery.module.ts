import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { AuthEmailDeliveryController } from "./auth-email-delivery.controller.js";
import { AuthEmailDeliveryGuard } from "./auth-email-delivery.guard.js";
import { AuthEmailDeliveryService } from "./auth-email-delivery.service.js";

@Module({
  imports: [IdentityModule],
  controllers: [AuthEmailDeliveryController],
  providers: [AuthEmailDeliveryGuard, AuthEmailDeliveryService]
})
export class AuthEmailDeliveryModule {}
