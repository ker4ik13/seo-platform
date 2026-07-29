import { Module } from "@nestjs/common";
import { IntegrationModule } from "../integrations/integration.module.js";
import { RankRunController } from "./rank-run.controller.js";
import { RankRunService } from "./rank-run.service.js";

@Module({
  imports: [IntegrationModule],
  controllers: [RankRunController],
  providers: [RankRunService],
  exports: [RankRunService]
})
export class RankRunModule {}
