import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { SemanticGroupColorLegendController } from "./semantic-group-color-legend.controller.js";
import { SemanticGroupColorLegendService } from "./semantic-group-color-legend.service.js";

@Module({
  imports: [InternalModule],
  controllers: [SemanticGroupColorLegendController],
  providers: [SemanticGroupColorLegendService]
})
export class SemanticGroupColorLegendModule {}
