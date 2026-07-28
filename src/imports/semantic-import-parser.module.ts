import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module.js";
import { SemanticImportParserService } from "./semantic-import-parser.service.js";

@Module({
  imports: [StorageModule],
  providers: [SemanticImportParserService],
  exports: [SemanticImportParserService]
})
export class SemanticImportParserModule {}
