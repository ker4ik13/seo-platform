import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { RealtimeClientModule } from "../realtime/realtime.module.js";
import {
  NotificationCenterController,
  NotificationPreferencesController,
  ProjectNotificationSubscriptionController
} from "./notification.controller.js";

@Module({
  imports: [AuthorizationModule, RealtimeClientModule],
  controllers: [
    NotificationCenterController,
    NotificationPreferencesController,
    ProjectNotificationSubscriptionController
  ]
})
export class NotificationModule {}
