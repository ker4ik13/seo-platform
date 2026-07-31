import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { IdentityModule } from "./identity/identity.module.js";
import { IntegrationModule } from "./integrations/integration.module.js";
import { TenantModule } from "./tenants/tenant.module.js";
import { MessagingModule } from "./messaging/messaging.module.js";
import { SystemModule } from "./system/system.module.js";
import { UploadModule } from "./uploads/upload.module.js";
import { SemanticImportModule } from "./imports/semantic-import.module.js";
import { SemanticModule } from "./semantics/semantic.module.js";
import { NotificationModule } from "./notifications/notification.module.js";
import { OutboxModule } from "./outbox/outbox.module.js";
import { RankingModule } from "./rankings/ranking.module.js";
import { AuthEmailDeliveryModule } from "./auth-email/auth-email-delivery.module.js";
import { BillingModule } from "./billing/billing.module.js";
import { PlatformAdminModule } from "./admin/platform-admin.module.js";
import { PageModule } from "./pages/page.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    MessagingModule,
    OutboxModule,
    AuthEmailDeliveryModule,
    HealthModule,
    IdentityModule,
    IntegrationModule,
    TenantModule,
    UploadModule,
    SemanticImportModule,
    SemanticModule,
    RankingModule,
    BillingModule,
    PlatformAdminModule,
    PageModule,
    NotificationModule,
    SystemModule
  ]
})
export class AppModule {}
