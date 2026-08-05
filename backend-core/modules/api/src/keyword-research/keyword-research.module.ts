import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { KeywordResearchController } from "./keyword-research.controller.js";

@Module({
  imports: [AuthorizationModule, BillingModule, IdentityModule, JobsModule],
  controllers: [KeywordResearchController]
})
export class KeywordResearchModule {}
