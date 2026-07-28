import { Module } from "@nestjs/common";
import { InternalApiGuard } from "./internal-api.guard.js";

@Module({
  providers: [InternalApiGuard],
  exports: [InternalApiGuard]
})
export class InternalModule {}
