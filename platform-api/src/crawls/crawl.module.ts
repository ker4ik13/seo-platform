import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { CrawlController } from "./crawl.controller.js";

@Module({
  imports: [
    AuthorizationModule,
    IdentityModule,
    JobsModule,
    SeoDataModule
  ],
  controllers: [CrawlController]
})
export class CrawlModule {}
