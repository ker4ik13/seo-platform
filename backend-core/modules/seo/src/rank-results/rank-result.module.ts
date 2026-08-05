import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { RankHistoryController } from "./rank-history.controller.js";
import { RankHistoryService } from "./rank-history.service.js";
import { RankResultController } from "./rank-result.controller.js";
import { RankResultService } from "./rank-result.service.js";

@Module({
  imports: [InternalModule],
  controllers: [RankResultController, RankHistoryController],
  providers: [RankResultService, RankHistoryService]
})
export class RankResultModule {}
