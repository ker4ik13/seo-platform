import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { MessagingModule } from "./messaging/messaging.module.js";
import { SystemModule } from "./system/system.module.js";
import { SemanticImportModule } from "./semantic-imports/semantic-import.module.js";
import { KeywordModule } from "./keywords/keyword.module.js";
import { KeywordGroupModule } from "./keyword-groups/keyword-group.module.js";
import { TrackingContextModule } from "./tracking-contexts/tracking-context.module.js";
import { RankScopeModule } from "./rank-scopes/rank-scope.module.js";
import { RankManifestModule } from "./rank-manifests/rank-manifest.module.js";
import { RankResultModule } from "./rank-results/rank-result.module.js";
import { SemanticSavedViewModule } from "./semantic-saved-views/semantic-saved-view.module.js";
import { SemanticCustomColumnModule } from "./semantic-custom-columns/semantic-custom-column.module.js";
import { SemanticVersionModule } from "./semantic-versions/semantic-version.module.js";
import { PageModule } from "./pages/page.module.js";
import { CrawlSnapshotModule } from "./crawls/crawl-snapshot.module.js";
import { ClusterModule } from "./clusters/cluster.module.js";
import { FrequencyModule } from "./frequencies/frequency.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    MessagingModule,
    HealthModule,
    SemanticImportModule,
    KeywordModule,
    KeywordGroupModule,
    ClusterModule,
    SemanticCustomColumnModule,
    SemanticSavedViewModule,
    SemanticVersionModule,
    PageModule,
    CrawlSnapshotModule,
    TrackingContextModule,
    RankScopeModule,
    RankManifestModule,
    RankResultModule,
    SystemModule,
    FrequencyModule
  ]
})
export class AppModule {}
