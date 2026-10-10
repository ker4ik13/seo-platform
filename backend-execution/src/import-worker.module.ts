import { PageStatusWorkerService } from "./page-status/page-status-worker.service.js";
import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { SemanticImportParserModule } from "./imports/semantic-import-parser.module.js";
import { KeywordResearchImportService } from "./keyword-research/keyword-research-import.service.js";
import { SeoDataModule } from "./seo-data/seo-data.module.js";
import { SemanticExportWorkerModule } from "./semantic-exports/semantic-export-worker.module.js";
import { FileRetentionService } from "./file-retention/file-retention.service.js";
import { StorageModule } from "./storage/storage.module.js";
import { RemoteWorkRetentionService } from "./worker-nodes/remote-work-retention.service.js";

@Module({
  imports: [
    ConfigModule.forRole("IMPORT_WORKER"),
    DatabaseModule,
    SemanticImportParserModule,
    SeoDataModule,
    SemanticExportWorkerModule,
    StorageModule
  ],
  providers: [PageStatusWorkerService, KeywordResearchImportService, FileRetentionService, RemoteWorkRetentionService]
})
export class ImportWorkerModule {}
