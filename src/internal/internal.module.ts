import { Module } from "@nestjs/common";
import { InternalApiGuard } from "./internal-api.guard.js";
import { RankExecutionApiGuard } from "./rank-execution-api.guard.js";
import { RankResultApiGuard } from "./rank-result-api.guard.js";

@Module({
  providers: [
    InternalApiGuard,
    RankExecutionApiGuard,
    RankResultApiGuard
  ],
  exports: [
    InternalApiGuard,
    RankExecutionApiGuard,
    RankResultApiGuard
  ]
})
export class InternalModule {}
