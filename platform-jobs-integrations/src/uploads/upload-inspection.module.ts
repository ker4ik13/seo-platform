import { Module } from "@nestjs/common";
import { MalwareModule } from "../malware/malware.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { UploadInspectionService } from "./upload-inspection.service.js";

@Module({
  imports: [StorageModule, MalwareModule],
  providers: [UploadInspectionService],
  exports: [UploadInspectionService]
})
export class UploadInspectionModule {}
