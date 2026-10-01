import { Module } from "@nestjs/common";
import { RemoteWorkClientModule } from "../worker-nodes/remote-work-client.module.js";
import { MalwareModule } from "../malware/malware.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { UploadInspectionService } from "./upload-inspection.service.js";

@Module({
  imports: [StorageModule, MalwareModule,RemoteWorkClientModule],
  providers: [UploadInspectionService],
  exports: [UploadInspectionService]
})
export class UploadInspectionModule {}
