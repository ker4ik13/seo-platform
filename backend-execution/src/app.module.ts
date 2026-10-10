import { PageStatusModule } from "./page-status/page-status.module.js";
import { Module } from "@nestjs/common";
import { PaidOperationModule } from "./paid-operations/paid-operation.module.js";
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
import { AutomationModule } from "./automations/automation.module.js";
import { CrawlModule } from "./crawls/crawl.module.js";
import { CrawlAutomationModule } from "./crawl-automations/crawl-automation.module.js";
import { KeywordResearchModule } from "./keyword-research/keyword-research.module.js";
import { CrawlNotificationModule } from "./crawl-notifications/crawl-notification.module.js";
import { FrequencyCollectionModule } from "./frequency-collections/frequency-collection.module.js";
import { JobNotificationModule } from "./job-notifications/job-notification.module.js";
import { OperationActivityModule } from "./operation-activity/operation-activity.module.js";
import { SemanticExportModule } from "./semantic-exports/semantic-export.module.js";
import { AiAnswerCollectionModule } from "./ai-answer-collections/ai-answer-collection.module.js";
import { ClusteringRunModule } from "./clustering-runs/clustering-run.module.js";
import { WorkerNodeModule } from "./worker-nodes/worker-node.module.js";

@Module({
  imports: [
    PageStatusModule,
    PaidOperationModule,
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
    SemanticImportModule,
    AutomationModule,
    CrawlModule,
    CrawlAutomationModule,
    CrawlNotificationModule,
    KeywordResearchModule,
    FrequencyCollectionModule,
    JobNotificationModule,
    OperationActivityModule,
    SemanticExportModule,
    AiAnswerCollectionModule,
    ClusteringRunModule,
    WorkerNodeModule
  ]
})
export class AppModule {}
