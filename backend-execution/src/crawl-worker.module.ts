import { Module } from "@nestjs/common";
import { RemoteWorkClientModule } from "./worker-nodes/remote-work-client.module.js";
import { ConfigModule } from "./config/config.module.js";
import { CrawlModule } from "./crawls/crawl.module.js";
import { CrawlRunnerService } from "./crawls/crawl-runner.service.js";
import { DatabaseModule } from "./database/database.module.js";
import { SeoDataModule } from "./seo-data/seo-data.module.js";

@Module({
  imports: [
    ConfigModule.forRole("CRAWL_WORKER"),
    DatabaseModule,
    SeoDataModule,
    CrawlModule
    ,RemoteWorkClientModule
  ],
  providers: [CrawlRunnerService]
})
export class CrawlWorkerModule {}
