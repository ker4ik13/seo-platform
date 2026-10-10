import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { ProductAnalyticsController } from "./product-analytics.controller.js";
import { ProductAnalyticsService } from "./product-analytics.service.js";
@Module({
  imports: [IdentityModule, AuthorizationModule],
  controllers: [ProductAnalyticsController],
  providers: [ProductAnalyticsService],
  exports: [ProductAnalyticsService],
})
export class ProductAnalyticsModule {}
