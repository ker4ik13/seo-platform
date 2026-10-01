import { Module } from "@nestjs/common";
import { RemoteWorkClientModule } from "../worker-nodes/remote-work-client.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { SeoDataModule } from "../seo-data/seo-data.module.js";
import { SemanticImportParserService } from "./semantic-import-parser.service.js";
import { SemanticImportPublisherService } from "./semantic-import-publisher.service.js";
import { SemanticImportValidatorService } from "./semantic-import-validator.service.js";

@Module({
  imports: [StorageModule, SeoDataModule,RemoteWorkClientModule],
  providers: [
    SemanticImportParserService,
    SemanticImportValidatorService,
    SemanticImportPublisherService
  ],
  exports: [
    SemanticImportParserService,
    SemanticImportValidatorService,
    SemanticImportPublisherService
  ]
})
export class SemanticImportParserModule {}
