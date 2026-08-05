import { Module } from "@nestjs/common";
import { PlatformApiModule } from "../platform-api/platform-api.module.js";
import { CrawlNotificationDispatcherService } from "./crawl-notification-dispatcher.service.js";

@Module({
  imports: [PlatformApiModule],
  providers: [CrawlNotificationDispatcherService]
})
export class CrawlNotificationModule {}
