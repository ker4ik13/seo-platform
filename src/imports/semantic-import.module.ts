import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { SemanticImportController } from "./semantic-import.controller.js";

@Module({
  imports: [AuthorizationModule, JobsModule],
  controllers: [SemanticImportController]
})
export class SemanticImportModule {}
