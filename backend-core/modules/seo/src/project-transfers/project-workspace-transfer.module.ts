import { Module } from "@nestjs/common";
import { ProjectWorkspaceTransferController } from "./project-workspace-transfer.controller.js";
import { ProjectWorkspaceTransferService } from "./project-workspace-transfer.service.js";

@Module({
  controllers: [ProjectWorkspaceTransferController],
  providers: [ProjectWorkspaceTransferService]
})
export class ProjectWorkspaceTransferModule {}
