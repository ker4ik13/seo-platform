import { Module } from "@nestjs/common";
import { JobsApiGuard } from "./jobs-api.guard.js";
import { PlatformApiGuard } from "./platform-api.guard.js";
import { RankExecutionApiGuard } from "./rank-execution-api.guard.js";
import { RankResultApiGuard } from "./rank-result-api.guard.js";

@Module({
  providers: [
    PlatformApiGuard,
    JobsApiGuard,
    RankExecutionApiGuard,
    RankResultApiGuard
  ],
  exports: [
    PlatformApiGuard,
    JobsApiGuard,
    RankExecutionApiGuard,
    RankResultApiGuard
  ]
})
export class InternalModule {}
