import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { UploadController } from "./upload.controller.js";

@Module({
  imports: [AuthorizationModule, BillingModule, IdentityModule, JobsModule],
  controllers: [UploadController]
})
export class UploadModule {}
