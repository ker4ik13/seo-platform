import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { MessagingModule } from "./messaging/messaging.module.js";
import { SystemModule } from "./system/system.module.js";
import { SemanticImportModule } from "./semantic-imports/semantic-import.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    MessagingModule,
    HealthModule,
    SemanticImportModule,
    SystemModule
  ]
})
export class AppModule {}
