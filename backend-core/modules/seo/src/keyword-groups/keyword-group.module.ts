import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { KeywordGroupController } from "./keyword-group.controller.js";
import { KeywordGroupService } from "./keyword-group.service.js";

@Module({
  imports: [InternalModule],
  controllers: [KeywordGroupController],
  providers: [KeywordGroupService],
  exports: [KeywordGroupService]
})
export class KeywordGroupModule {}
