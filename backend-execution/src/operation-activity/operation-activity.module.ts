import { PageStatusModule } from "../page-status/page-status.module.js";
import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { RankRunModule } from "../rank-runs/rank-run.module.js";
import { FrequencyCollectionModule } from "../frequency-collections/frequency-collection.module.js";
import { AiAnswerCollectionModule } from "../ai-answer-collections/ai-answer-collection.module.js";
import { ClusteringRunModule } from "../clustering-runs/clustering-run.module.js";
import { KeywordResearchModule } from "../keyword-research/keyword-research.module.js";
import { CrawlModule } from "../crawls/crawl.module.js";
import { SemanticExportModule } from "../semantic-exports/semantic-export.module.js";
import { SemanticImportModule } from "../imports/semantic-import.module.js";
import { OperationCancellationService } from "./operation-cancellation.service.js";
import {
  OperationActivityController,
  PlatformAdminOperationController,
  ProjectOperationController
} from "./operation-activity.controller.js";
import { OperationActivityService } from "./operation-activity.service.js";
import { OperationAnalyticsService } from "./operation-analytics.service.js";

@Module({
  imports: [PageStatusModule, InternalModule, RankRunModule, FrequencyCollectionModule, AiAnswerCollectionModule, ClusteringRunModule, KeywordResearchModule, CrawlModule, SemanticExportModule, SemanticImportModule],
  controllers: [
    OperationActivityController,
    PlatformAdminOperationController,
    ProjectOperationController
  ],
  providers: [OperationActivityService, OperationCancellationService, OperationAnalyticsService]
})
export class OperationActivityModule {}
