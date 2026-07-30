import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { EmailModule } from "./email/email.module.js";
import { HealthModule } from "./health/health.module.js";
import { InternalModule } from "./internal/internal.module.js";
import { IntegrationModule } from "./integrations/integration.module.js";
import { MessagingModule } from "./messaging/messaging.module.js";
import { QueueModule } from "./queue/queue.module.js";
import { RankEstimateModule } from "./rank-estimates/rank-estimate.module.js";
import { RankRunModule } from "./rank-runs/rank-run.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { SystemModule } from "./system/system.module.js";
import { UploadModule } from "./uploads/upload.module.js";
import { SemanticImportModule } from "./imports/semantic-import.module.js";

@Module({
  imports: [
    ConfigModule.forRole("HTTP"),
    DatabaseModule,
    MessagingModule,
    QueueModule,
    StorageModule,
    EmailModule,
    InternalModule,
    IntegrationModule,
    RankEstimateModule,
    RankRunModule,
    HealthModule,
    SystemModule,
    UploadModule,
    SemanticImportModule
  ]
})
export class AppModule {}
