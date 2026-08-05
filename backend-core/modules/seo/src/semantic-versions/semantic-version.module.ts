import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { SemanticVersionController } from "./semantic-version.controller.js";
import { SemanticVersionService } from "./semantic-version.service.js";

@Module({
  imports: [InternalModule],
  controllers: [SemanticVersionController],
  providers: [SemanticVersionService],
  exports: [SemanticVersionService]
})
export class SemanticVersionModule {}
