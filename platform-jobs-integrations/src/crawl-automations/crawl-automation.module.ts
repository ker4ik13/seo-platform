import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { PlatformApiModule } from "../platform-api/platform-api.module.js";
import { CrawlAutomationController } from "./crawl-automation.controller.js";
import { CrawlAutomationExecutionService } from "./crawl-automation-execution.service.js";
import { CrawlAutomationRuntimeService } from "./crawl-automation-runtime.service.js";
import { CrawlAutomationService } from "./crawl-automation.service.js";

@Module({
  imports: [InternalModule, PlatformApiModule],
  controllers: [CrawlAutomationController],
  providers: [
    CrawlAutomationExecutionService,
    CrawlAutomationRuntimeService,
    CrawlAutomationService
  ],
  exports: [CrawlAutomationExecutionService, CrawlAutomationService]
})
export class CrawlAutomationModule {}
