import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { NotificationController } from "./notification.controller.js";
import { NotificationService } from "./notification.service.js";

@Module({
  imports: [InternalModule],
  controllers: [NotificationController],
  providers: [NotificationService]
})
export class NotificationModule {}
