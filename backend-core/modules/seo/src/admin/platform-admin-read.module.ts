import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { PlatformAdminReadController } from "./platform-admin-read.controller.js";
import { PlatformAdminReadService } from "./platform-admin-read.service.js";

@Module({
  imports: [InternalModule],
  controllers: [PlatformAdminReadController],
  providers: [PlatformAdminReadService]
})
export class PlatformAdminReadModule {}
