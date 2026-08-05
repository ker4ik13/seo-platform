import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { SemanticVersionModule } from "../semantic-versions/semantic-version.module.js";
import { KeywordController } from "./keyword.controller.js";
import { KeywordService } from "./keyword.service.js";

@Module({
  imports: [InternalModule, SemanticVersionModule],
  controllers: [KeywordController],
  providers: [KeywordService]
})
export class KeywordModule {}
