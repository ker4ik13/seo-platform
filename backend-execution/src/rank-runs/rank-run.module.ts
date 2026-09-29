import { Module } from "@nestjs/common";
import { IntegrationModule } from "../integrations/integration.module.js";
import { RankRunController } from "./rank-run.controller.js";
import { RankRunService } from "./rank-run.service.js";
import { RankOperationProvenanceService } from "./rank-operation-provenance.service.js";

@Module({
  imports: [IntegrationModule],
  controllers: [RankRunController],
  providers: [RankRunService, RankOperationProvenanceService],
  exports: [RankRunService, RankOperationProvenanceService]
})
export class RankRunModule {}
