import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import { IdentityModule } from "../identity/identity.module.js";
import { RealtimeClientModule } from "../realtime/realtime.module.js";
import {
  NotificationCenterController,
  NotificationPreferencesController,
  ProjectNotificationSubscriptionController
} from "./notification.controller.js";
import { WebPushSubscriptionController } from "./web-push.controller.js";
import { DeliveryAuthorizationController } from "./delivery-authorization.controller.js";
import { DeliveryAuthorizationGuard } from "./delivery-authorization.guard.js";

@Module({
  imports: [AuthorizationModule, IdentityModule, RealtimeClientModule],
  controllers: [
    NotificationCenterController,
    NotificationPreferencesController,
    ProjectNotificationSubscriptionController,
    WebPushSubscriptionController,
    DeliveryAuthorizationController
  ],
  providers: [DeliveryAuthorizationGuard]
})
export class NotificationModule {}
