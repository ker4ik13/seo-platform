import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { RankWorkbenchController } from "./rank-workbench.controller.js";
import { RankWorkbenchService } from "./rank-workbench.service.js";

@Module({
  imports: [InternalModule],
  controllers: [RankWorkbenchController],
  providers: [RankWorkbenchService]
})
export class RankWorkbenchModule {}
