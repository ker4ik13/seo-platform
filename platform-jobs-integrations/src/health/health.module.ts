import { Module } from "@nestjs/common";
import { EmailModule } from "../email/email.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { HealthController } from "./health.controller.js";

@Module({
  imports: [StorageModule, EmailModule],
  controllers: [HealthController]
})
export class HealthModule {}
