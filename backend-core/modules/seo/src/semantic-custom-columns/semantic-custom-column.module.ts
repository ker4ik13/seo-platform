import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { SemanticCustomColumnController } from "./semantic-custom-column.controller.js";
import { SemanticCustomColumnService } from "./semantic-custom-column.service.js";

@Module({
  imports: [InternalModule],
  controllers: [SemanticCustomColumnController],
  providers: [SemanticCustomColumnService],
  exports: [SemanticCustomColumnService]
})
export class SemanticCustomColumnModule {}
