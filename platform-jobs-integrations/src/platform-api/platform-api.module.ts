import { Module } from "@nestjs/common";
import { CrawlAutomationDispatchClient } from "./crawl-automation-dispatch.client.js";
import { CrawlNotificationClient } from "./crawl-notification.client.js";
import { RankExecutionGrantClient } from "./rank-execution-grant.client.js";

@Module({
  providers: [
    CrawlAutomationDispatchClient,
    CrawlNotificationClient,
    RankExecutionGrantClient
  ],
  exports: [
    CrawlAutomationDispatchClient,
    CrawlNotificationClient,
    RankExecutionGrantClient
  ]
})
export class PlatformApiModule {}
