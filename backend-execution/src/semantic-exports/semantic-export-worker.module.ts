import { Module } from "@nestjs/common";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { SemanticExportWorkerService } from "./semantic-export-worker.service.js";

@Module({
  imports: [SeoDataModule, StorageModule],
  providers: [SemanticExportWorkerService],
  exports: [SemanticExportWorkerService]
})
export class SemanticExportWorkerModule {}
