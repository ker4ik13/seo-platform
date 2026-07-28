import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { EmailModule } from "./email/email.module.js";
import { HealthModule } from "./health/health.module.js";
import { InternalModule } from "./internal/internal.module.js";
import { MessagingModule } from "./messaging/messaging.module.js";
import { QueueModule } from "./queue/queue.module.js";
import { StorageModule } from "./storage/storage.module.js";
import { SystemModule } from "./system/system.module.js";
import { UploadModule } from "./uploads/upload.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    MessagingModule,
    QueueModule,
    StorageModule,
    EmailModule,
    InternalModule,
    HealthModule,
    SystemModule,
    UploadModule
  ]
})
export class AppModule {}
