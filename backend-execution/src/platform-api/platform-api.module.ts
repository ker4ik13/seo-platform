import { Module } from "@nestjs/common";
import { CrawlAutomationDispatchClient } from "./crawl-automation-dispatch.client.js";
import { CrawlNotificationClient } from "./crawl-notification.client.js";
import { JobNotificationClient } from "./job-notification.client.js";
import { RankBillingSettlementClient } from "./rank-billing-settlement.client.js";
import { RankExecutionGrantClient } from "./rank-execution-grant.client.js";

@Module({
  providers: [
    CrawlAutomationDispatchClient,
    CrawlNotificationClient,
    JobNotificationClient,
    RankBillingSettlementClient,
    RankExecutionGrantClient
  ],
  exports: [
    CrawlAutomationDispatchClient,
    CrawlNotificationClient,
    JobNotificationClient,
    RankBillingSettlementClient,
    RankExecutionGrantClient
  ]
})
export class PlatformApiModule {}
