import { Module } from "@nestjs/common";
import { PlatformApiModule } from "../platform-api/platform-api.module.js";
import { JobNotificationDispatcherService } from "./job-notification-dispatcher.service.js";

@Module({
  imports: [PlatformApiModule],
  providers: [JobNotificationDispatcherService]
})
export class JobNotificationModule {}
