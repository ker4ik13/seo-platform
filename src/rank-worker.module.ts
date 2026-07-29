import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { RankPreparationService } from "./rank-runs/rank-preparation.service.js";
import { SeoDataModule } from "./seo-data/seo-data.module.js";

@Module({
  imports: [ConfigModule, DatabaseModule, SeoDataModule],
  providers: [RankPreparationService]
})
export class RankWorkerModule {}
