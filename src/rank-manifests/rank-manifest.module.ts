import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { RankManifestController } from "./rank-manifest.controller.js";
import { RankManifestService } from "./rank-manifest.service.js";

@Module({
  imports: [InternalModule],
  controllers: [RankManifestController],
  providers: [RankManifestService]
})
export class RankManifestModule {}
