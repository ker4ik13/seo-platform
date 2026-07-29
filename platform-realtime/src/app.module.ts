import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { MessagingModule } from "./messaging/messaging.module.js";
import { RealtimeModule } from "./realtime/realtime.module.js";
import { RedisModule } from "./redis/redis.module.js";
import { SystemModule } from "./system/system.module.js";
import { NotificationModule } from "./notifications/notification.module.js";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    MessagingModule,
    RedisModule,
    RealtimeModule,
    NotificationModule,
    HealthModule,
    SystemModule
  ]
})
export class AppModule {}
