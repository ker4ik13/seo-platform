import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { RankRunModule } from "../rank-runs/rank-run.module.js";
import { FrequencyCollectionModule } from "../frequency-collections/frequency-collection.module.js";
import { AiAnswerCollectionModule } from "../ai-answer-collections/ai-answer-collection.module.js";
import { ClusteringRunModule } from "../clustering-runs/clustering-run.module.js";
import { KeywordResearchModule } from "../keyword-research/keyword-research.module.js";
import { CrawlModule } from "../crawls/crawl.module.js";
import { SemanticExportModule } from "../semantic-exports/semantic-export.module.js";
import { OperationCancellationService } from "./operation-cancellation.service.js";
import {
  OperationActivityController,
  PlatformAdminOperationController,
  ProjectOperationController
} from "./operation-activity.controller.js";
import { OperationActivityService } from "./operation-activity.service.js";

@Module({
  imports: [InternalModule, RankRunModule, FrequencyCollectionModule, AiAnswerCollectionModule, ClusteringRunModule, KeywordResearchModule, CrawlModule, SemanticExportModule],
  controllers: [
    OperationActivityController,
    PlatformAdminOperationController,
    ProjectOperationController
  ],
  providers: [OperationActivityService, OperationCancellationService]
})
export class OperationActivityModule {}
