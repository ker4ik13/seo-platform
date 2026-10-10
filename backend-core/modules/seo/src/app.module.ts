import { Module } from "@nestjs/common";
import { ProjectOnboardingModule } from "./project-onboarding/project-onboarding.module.js";
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
import { AiAnswerModule } from "./ai-answers/ai-answer.module.js";
import { ClusteringProposalModule } from "./clustering-proposals/clustering-proposal.module.js";
import { OperationResultModule } from "./operation-results/operation-result.module.js";
import { ProjectWorkspaceTransferModule } from "./project-transfers/project-workspace-transfer.module.js";
import { NegativeKeywordModule } from "./negative-keywords/negative-keyword.module.js";
import { SemanticDuplicateModule } from "./semantic-duplicates/semantic-duplicate.module.js";
import { ProjectNoteModule } from "./notes/project-note.module.js";
import { PlatformAdminReadModule } from "./admin/platform-admin-read.module.js";
import { SemanticExportReadModule } from "./semantic-exports/semantic-export-read.module.js";
import { SemanticGroupColorLegendModule } from "./semantic-group-color-legends/semantic-group-color-legend.module.js";
import { RankWorkbenchModule } from "./rank-workbench/rank-workbench.module.js";

@Module({
  imports: [
    ProjectOnboardingModule,
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
    FrequencyModule,
    AiAnswerModule,
    ClusteringProposalModule,
    OperationResultModule,
    NegativeKeywordModule,
    SemanticDuplicateModule,
    SemanticGroupColorLegendModule,
    SemanticExportReadModule,
    ProjectNoteModule,
    PlatformAdminReadModule,
    ProjectWorkspaceTransferModule,
    RankWorkbenchModule
  ]
})
export class AppModule {}
