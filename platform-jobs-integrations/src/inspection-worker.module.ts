import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { UploadInspectionModule } from "./uploads/upload-inspection.module.js";

@Module({
  imports: [ConfigModule, DatabaseModule, UploadInspectionModule]
})
export class InspectionWorkerModule {}
