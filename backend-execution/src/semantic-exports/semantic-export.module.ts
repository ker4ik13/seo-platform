import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { SemanticExportController } from "./semantic-export.controller.js";
import { SemanticExportService } from "./semantic-export.service.js";

@Module({
  imports: [InternalModule, StorageModule],
  controllers: [SemanticExportController],
  providers: [SemanticExportService],
  exports: [SemanticExportService]
})
export class SemanticExportModule {}
