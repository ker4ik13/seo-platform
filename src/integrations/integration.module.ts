import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { IntegrationController } from "./integration.controller.js";

@Module({
  imports: [IdentityModule, JobsModule],
  controllers: [IntegrationController]
})
export class IntegrationModule {}
