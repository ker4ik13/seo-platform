import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { RankEstimateModule } from "../rank-estimates/rank-estimate.module.js";
import { RankRunModule } from "../rank-runs/rank-run.module.js";
import { AutomationController } from "./automation.controller.js";
import { AutomationExecutionService } from "./automation-execution.service.js";
import { AutomationRuntimeService } from "./automation-runtime.service.js";
import { AutomationService } from "./automation.service.js";

@Module({
  imports: [InternalModule, RankEstimateModule, RankRunModule],
  controllers: [AutomationController],
  providers: [
    AutomationExecutionService,
    AutomationRuntimeService,
    AutomationService
  ],
  exports: [AutomationExecutionService, AutomationService]
})
export class AutomationModule {}
