import { PageStatusController } from "./page-status.controller.js";
import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { PageController } from "./page.controller.js";
import { PageService } from "./page.service.js";
import { PageInsightsService } from "./page-insights.service.js";

@Module({
  imports: [InternalModule],
  controllers: [PageController, PageStatusController],
  providers: [PageService, PageInsightsService]
})
export class PageModule {}
