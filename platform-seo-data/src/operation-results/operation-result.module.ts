import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { OperationResultController } from "./operation-result.controller.js";
import { OperationResultService } from "./operation-result.service.js";

@Module({
  imports: [InternalModule],
  controllers: [OperationResultController],
  providers: [OperationResultService]
})
export class OperationResultModule {}
