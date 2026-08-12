import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { SemanticVersionModule } from "../semantic-versions/semantic-version.module.js";
import { SemanticDuplicateController } from "./semantic-duplicate.controller.js";
import { SemanticDuplicateService } from "./semantic-duplicate.service.js";

@Module({
  imports: [InternalModule, SemanticVersionModule],
  controllers: [SemanticDuplicateController],
  providers: [SemanticDuplicateService]
})
export class SemanticDuplicateModule {}
