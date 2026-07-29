import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { RealtimeClientModule } from "../realtime/realtime.module.js";
import {
  NotificationCenterController,
  NotificationPreferencesController,
  ProjectNotificationSubscriptionController
} from "./notification.controller.js";

@Module({
  imports: [AuthorizationModule, IdentityModule, RealtimeClientModule],
  controllers: [
    NotificationCenterController,
    NotificationPreferencesController,
    ProjectNotificationSubscriptionController
  ]
})
export class NotificationModule {}
