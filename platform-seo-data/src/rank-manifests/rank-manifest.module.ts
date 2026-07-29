import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { RankFinalizationController } from "./rank-finalization.controller.js";
import { RankFinalizationService } from "./rank-finalization.service.js";
import { RankManifestController } from "./rank-manifest.controller.js";
import { RankManifestService } from "./rank-manifest.service.js";

@Module({
  imports: [InternalModule],
  controllers: [RankManifestController, RankFinalizationController],
  providers: [RankManifestService, RankFinalizationService]
})
export class RankManifestModule {}
