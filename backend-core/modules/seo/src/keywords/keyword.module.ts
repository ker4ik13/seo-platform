import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { SemanticVersionModule } from "../semantic-versions/semantic-version.module.js";
import { KeywordController } from "./keyword.controller.js";
import { KeywordService } from "./keyword.service.js";
import { KeywordRankComparisonService } from "./keyword-rank-comparison.service.js";
import { KeywordRankComparisonController } from "./keyword-rank-comparison.controller.js";

@Module({
  imports: [InternalModule, SemanticVersionModule],
  controllers: [KeywordController, KeywordRankComparisonController],
  providers: [KeywordService, KeywordRankComparisonService],
  exports: [KeywordService, KeywordRankComparisonService]
})
export class KeywordModule {}
