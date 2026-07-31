import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { CrawlController } from "./crawl.controller.js";
import { CrawlAutomationDispatchController } from "./crawl-automation-dispatch.controller.js";
import { CrawlAutomationDispatchGuard } from "./crawl-automation-dispatch.guard.js";
import { CrawlAutomationController } from "./crawl-automation.controller.js";

@Module({
  imports: [
    AuthorizationModule,
    BillingModule,
    IdentityModule,
    JobsModule,
    SeoDataModule
  ],
  controllers: [
    CrawlAutomationController,
    CrawlAutomationDispatchController,
    CrawlController
  ],
  providers: [CrawlAutomationDispatchGuard]
})
export class CrawlModule {}
