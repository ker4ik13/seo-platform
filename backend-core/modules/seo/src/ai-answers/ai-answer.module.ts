import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import {
  AiAnswerCommandController,
  AiAnswerReadController
} from "./ai-answer.controller.js";
import { AiAnswerService } from "./ai-answer.service.js";

@Module({
  imports: [InternalModule],
  controllers: [AiAnswerCommandController, AiAnswerReadController],
  providers: [AiAnswerService],
  exports: [AiAnswerService]
})
export class AiAnswerModule {}
