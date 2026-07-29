import { Module } from "@nestjs/common";
import { InternalApiGuard } from "./internal-api.guard.js";
import { RankExecutionApiGuard } from "./rank-execution-api.guard.js";

@Module({
  providers: [InternalApiGuard, RankExecutionApiGuard],
  exports: [InternalApiGuard, RankExecutionApiGuard]
})
export class InternalModule {}
