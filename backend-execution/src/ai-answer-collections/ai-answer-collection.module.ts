import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { IntegrationModule } from "../integrations/integration.module.js";
import { AiAnswerCollectionController } from "./ai-answer-collection.controller.js";
import { AiAnswerCollectionService } from "./ai-answer-collection.service.js";

@Module({
  imports: [InternalModule, IntegrationModule],
  controllers: [AiAnswerCollectionController],
  providers: [AiAnswerCollectionService],
  exports: [AiAnswerCollectionService]
})
export class AiAnswerCollectionModule {}
