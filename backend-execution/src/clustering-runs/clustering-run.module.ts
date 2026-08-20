import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { IntegrationModule } from "../integrations/integration.module.js";
import { ClusteringRunController } from "./clustering-run.controller.js";
import { ClusteringRunService } from "./clustering-run.service.js";

@Module({
  imports: [InternalModule, IntegrationModule],
  controllers: [ClusteringRunController],
  providers: [ClusteringRunService]
})
export class ClusteringRunModule {}
