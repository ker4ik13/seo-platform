import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { IdentityModule } from "./identity/identity.module.js";
import { TenantModule } from "./tenants/tenant.module.js";
import { MessagingModule } from "./messaging/messaging.module.js";
import { SystemModule } from "./system/system.module.js";
import { UploadModule } from "./uploads/upload.module.js";
import { SemanticImportModule } from "./imports/semantic-import.module.js";
import { SemanticModule } from "./semantics/semantic.module.js";
import { NotificationModule } from "./notifications/notification.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    MessagingModule,
    HealthModule,
    IdentityModule,
    TenantModule,
    UploadModule,
    SemanticImportModule,
    SemanticModule,
    NotificationModule,
    SystemModule
  ]
})
export class AppModule {}
