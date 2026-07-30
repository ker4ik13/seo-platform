import { Module } from "@nestjs/common";
import { PlatformApiGuard } from "./platform-api.guard.js";

@Module({
  providers: [PlatformApiGuard],
  exports: [PlatformApiGuard]
})
export class InternalModule {}
