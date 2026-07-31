import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { SemanticImportParserModule } from "./imports/semantic-import-parser.module.js";
import { KeywordResearchImportService } from "./keyword-research/keyword-research-import.service.js";
import { SeoDataModule } from "./seo-data/seo-data.module.js";

@Module({
  imports: [
    ConfigModule.forRole("IMPORT_WORKER"),
    DatabaseModule,
    SemanticImportParserModule,
    SeoDataModule
  ],
  providers: [KeywordResearchImportService]
})
export class ImportWorkerModule {}
