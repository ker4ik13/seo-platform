import { Module } from "@nestjs/common";
import { DependencyHealthService } from "./dependency-health.service.js";
import { HealthController } from "./health.controller.js";

@Module({
  controllers: [HealthController],
  providers: [DependencyHealthService]
})
export class HealthModule {}
