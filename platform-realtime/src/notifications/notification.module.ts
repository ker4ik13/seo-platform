import { Module } from "@nestjs/common";
import { InternalModule } from "../internal/internal.module.js";
import { NotificationCenterService } from "./notification-center.service.js";
import { NotificationController } from "./notification.controller.js";
import { NotificationService } from "./notification.service.js";
import { SessionFamilyRevocationService } from "./session-family-revocation.service.js";
import { WebPushApiGuard } from "./web-push-api.guard.js";
import { WebPushController } from "./web-push.controller.js";
import { WebPushCryptoService } from "./web-push-crypto.service.js";
import { WebPushKeyCoverageService } from "./web-push-key-coverage.service.js";
import { WebPushService } from "./web-push.service.js";

@Module({
  imports: [InternalModule],
  controllers: [NotificationController, WebPushController],
  providers: [
    NotificationCenterService,
    NotificationService,
    SessionFamilyRevocationService,
    WebPushApiGuard,
    WebPushCryptoService,
    WebPushKeyCoverageService,
    WebPushService
  ],
  exports: [SessionFamilyRevocationService]
})
export class NotificationModule {}
