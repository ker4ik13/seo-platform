import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { SemanticVersionModule } from "../semantic-versions/semantic-version.module.js";
import { NegativeKeywordController } from "./negative-keyword.controller.js";
import { NegativeKeywordService } from "./negative-keyword.service.js";

@Module({
  imports: [InternalModule, SemanticVersionModule],
  controllers: [NegativeKeywordController],
  providers: [NegativeKeywordService]
})
export class NegativeKeywordModule {}
