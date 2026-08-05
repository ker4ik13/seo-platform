import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { CrawlAutomationDispatchGuard } from "../crawls/crawl-automation-dispatch.guard.js";
import { RealtimeClientModule } from "../realtime/realtime.module.js";
import { JobNotificationController } from "./job-notification.controller.js";
import { JobsClient } from "./jobs.client.js";

@Module({
  imports: [AuthorizationModule, RealtimeClientModule],
  controllers: [JobNotificationController],
  providers: [JobsClient, CrawlAutomationDispatchGuard],
  exports: [JobsClient]
})
export class JobsModule {}
