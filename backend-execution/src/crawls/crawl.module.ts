import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { CrawlController } from "./crawl.controller.js";
import { CrawlHostStateService } from "./crawl-host-state.service.js";
import { CrawlService } from "./crawl.service.js";

@Module({
  imports: [InternalModule],
  controllers: [CrawlController],
  providers: [CrawlHostStateService, CrawlService],
  exports: [CrawlHostStateService, CrawlService]
})
export class CrawlModule {}
