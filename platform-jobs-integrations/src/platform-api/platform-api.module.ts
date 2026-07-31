import { Module } from "@nestjs/common";
import { CrawlAutomationDispatchClient } from "./crawl-automation-dispatch.client.js";
import { RankExecutionGrantClient } from "./rank-execution-grant.client.js";

@Module({
  providers: [CrawlAutomationDispatchClient, RankExecutionGrantClient],
  exports: [CrawlAutomationDispatchClient, RankExecutionGrantClient]
})
export class PlatformApiModule {}
