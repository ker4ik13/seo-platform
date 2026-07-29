import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { MessagingModule } from "./messaging/messaging.module.js";
import { SystemModule } from "./system/system.module.js";
import { SemanticImportModule } from "./semantic-imports/semantic-import.module.js";
import { KeywordModule } from "./keywords/keyword.module.js";
import { TrackingContextModule } from "./tracking-contexts/tracking-context.module.js";
import { RankScopeModule } from "./rank-scopes/rank-scope.module.js";
import { RankManifestModule } from "./rank-manifests/rank-manifest.module.js";
import { RankResultModule } from "./rank-results/rank-result.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    MessagingModule,
    HealthModule,
    SemanticImportModule,
    KeywordModule,
    TrackingContextModule,
    RankScopeModule,
    RankManifestModule,
    RankResultModule,
    SystemModule
  ]
})
export class AppModule {}
