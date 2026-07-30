import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { SemanticImportParserModule } from "./imports/semantic-import-parser.module.js";

@Module({
  imports: [
    ConfigModule.forRole("IMPORT_WORKER"),
    DatabaseModule,
    SemanticImportParserModule
  ]
})
export class ImportWorkerModule {}
