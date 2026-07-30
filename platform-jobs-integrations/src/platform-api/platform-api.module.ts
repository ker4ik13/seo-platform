import { Module } from "@nestjs/common";
import { RankExecutionGrantClient } from "./rank-execution-grant.client.js";

@Module({
  providers: [RankExecutionGrantClient],
  exports: [RankExecutionGrantClient]
})
export class PlatformApiModule {}
