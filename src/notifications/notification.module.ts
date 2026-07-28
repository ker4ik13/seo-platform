import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { NotificationCenterService } from "./notification-center.service.js";
import { NotificationController } from "./notification.controller.js";
import { NotificationService } from "./notification.service.js";

@Module({
  imports: [InternalModule],
  controllers: [NotificationController],
  providers: [NotificationCenterService, NotificationService]
})
export class NotificationModule {}
