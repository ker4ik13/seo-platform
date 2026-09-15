import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { KeywordModule } from "../keywords/keyword.module.js";
import { SemanticImportController } from "./semantic-import.controller.js";
import { SemanticImportService } from "./semantic-import.service.js";

@Module({
  imports: [InternalModule, KeywordModule],
  controllers: [SemanticImportController],
  providers: [SemanticImportService]
})
export class SemanticImportModule {}
