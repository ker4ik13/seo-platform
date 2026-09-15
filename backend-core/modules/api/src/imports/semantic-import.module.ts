import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { SemanticImportController } from "./semantic-import.controller.js";

@Module({
  imports: [
    AuthorizationModule,
    BillingModule,
    DatabaseModule,
    IdentityModule,
    JobsModule
  ],
  controllers: [SemanticImportController]
})
export class SemanticImportModule {}
