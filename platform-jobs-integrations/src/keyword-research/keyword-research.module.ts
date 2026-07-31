import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { KeywordResearchController } from "./keyword-research.controller.js";
import { KeywordResearchService } from "./keyword-research.service.js";

@Module({
  imports: [InternalModule],
  controllers: [KeywordResearchController],
  providers: [KeywordResearchService],
  exports: [KeywordResearchService]
})
export class KeywordResearchModule {}
