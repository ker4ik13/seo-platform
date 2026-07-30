import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { PlatformApiModule } from "./platform-api/platform-api.module.js";
import { RankExecutionGrantAttemptService } from "./rank-runs/rank-execution-grant-attempt.service.js";
import { RankPreparationService } from "./rank-runs/rank-preparation.service.js";
import { SeoDataModule } from "./seo-data/seo-data.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    PlatformApiModule,
    SeoDataModule
  ],
  providers: [
    RankExecutionGrantAttemptService,
    RankPreparationService
  ]
})
export class RankWorkerModule {}
