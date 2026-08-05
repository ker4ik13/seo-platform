import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { SemanticImportController } from "./semantic-import.controller.js";
import { SemanticImportService } from "./semantic-import.service.js";

@Module({
  imports: [InternalModule],
  controllers: [SemanticImportController],
  providers: [SemanticImportService],
  exports: [SemanticImportService]
})
export class SemanticImportModule {}
