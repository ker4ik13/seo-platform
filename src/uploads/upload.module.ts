import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { UploadController } from "./upload.controller.js";
import { UploadService } from "./upload.service.js";

@Module({
  imports: [InternalModule, StorageModule],
  controllers: [UploadController],
  providers: [UploadService]
})
export class UploadModule {}
