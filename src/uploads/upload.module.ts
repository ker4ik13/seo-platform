import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { JobsUploadClient } from "./jobs-upload.client.js";
import { UploadController } from "./upload.controller.js";

@Module({
  imports: [AuthorizationModule],
  controllers: [UploadController],
  providers: [JobsUploadClient]
})
export class UploadModule {}
