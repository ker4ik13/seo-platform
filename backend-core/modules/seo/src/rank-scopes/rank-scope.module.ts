import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { RankScopeController } from "./rank-scope.controller.js";
import { RankScopeService } from "./rank-scope.service.js";

@Module({
  imports: [InternalModule],
  controllers: [RankScopeController],
  providers: [RankScopeService]
})
export class RankScopeModule {}
