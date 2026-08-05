import { Module } from "@nestjs/common";
import { IntegrationModule } from "../integrations/integration.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { RankEstimateController } from "./rank-estimate.controller.js";
import { RankEstimateService } from "./rank-estimate.service.js";

@Module({
  imports: [IntegrationModule, SeoDataModule],
  controllers: [RankEstimateController],
  providers: [RankEstimateService],
  exports: [RankEstimateService]
})
export class RankEstimateModule {}
