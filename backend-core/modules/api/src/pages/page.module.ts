import { JobsModule } from "../jobs/jobs.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { PageController } from "./page.controller.js";

@Module({
  imports: [JobsModule, BillingModule, AuthorizationModule, IdentityModule, SeoDataModule],
  controllers: [PageController]
})
export class PageModule {}
