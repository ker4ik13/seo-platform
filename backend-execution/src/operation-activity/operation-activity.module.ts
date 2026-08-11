import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import {
  OperationActivityController,
  PlatformAdminOperationController
} from "./operation-activity.controller.js";
import { OperationActivityService } from "./operation-activity.service.js";

@Module({
  imports: [InternalModule],
  controllers: [OperationActivityController, PlatformAdminOperationController],
  providers: [OperationActivityService]
})
export class OperationActivityModule {}
