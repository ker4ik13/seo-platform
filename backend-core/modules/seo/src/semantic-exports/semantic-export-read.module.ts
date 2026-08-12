import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { KeywordGroupModule } from "../keyword-groups/keyword-group.module.js";
import { KeywordModule } from "../keywords/keyword.module.js";
import { SemanticCustomColumnModule } from "../semantic-custom-columns/semantic-custom-column.module.js";
import { SemanticExportReadController } from "./semantic-export-read.controller.js";

@Module({
  imports: [
    InternalModule,
    KeywordModule,
    KeywordGroupModule,
    SemanticCustomColumnModule
  ],
  controllers: [SemanticExportReadController]
})
export class SemanticExportReadModule {}
