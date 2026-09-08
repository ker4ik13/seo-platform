import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { KeywordGroupModule } from "../keyword-groups/keyword-group.module.js";
import { KeywordModule } from "../keywords/keyword.module.js";
import { SemanticCustomColumnModule } from "../semantic-custom-columns/semantic-custom-column.module.js";
import { SemanticExportReadController } from "./semantic-export-read.controller.js";
import { SemanticRankExportReadController } from "./semantic-rank-export-read.controller.js";
import { SemanticCompetitorExportService } from "./semantic-competitor-export.service.js";
import { SemanticPositionHistoryExportService } from "./semantic-position-history-export.service.js";

@Module({
  imports: [
    InternalModule,
    KeywordModule,
    KeywordGroupModule,
    SemanticCustomColumnModule
  ],
  controllers: [SemanticExportReadController, SemanticRankExportReadController],
  providers: [
    SemanticCompetitorExportService,
    SemanticPositionHistoryExportService
  ]
})
export class SemanticExportReadModule {}
