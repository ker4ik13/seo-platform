import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { CrawlController } from "./crawl.controller.js";
import { CrawlService } from "./crawl.service.js";

@Module({
  imports: [InternalModule],
  controllers: [CrawlController],
  providers: [CrawlService],
  exports: [CrawlService]
})
export class CrawlModule {}
