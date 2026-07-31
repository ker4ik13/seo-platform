import { Module } from "@nestjs/common";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { WebPushCryptoService } from "./notifications/web-push-crypto.service.js";
import { WebPushDeliveryWorker } from "./notifications/web-push-delivery.worker.js";
import { WebPushKeyCoverageService } from "./notifications/web-push-key-coverage.service.js";
import {
  NodeWebPushTransport,
  WEB_PUSH_TRANSPORT
} from "./notifications/web-push-transport.js";
import {
  PlatformProjectDeliveryAuthorizer,
  PROJECT_DELIVERY_AUTHORIZER
} from "./notifications/project-delivery-authorizer.js";

@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [
    WebPushCryptoService,
    WebPushDeliveryWorker,
    WebPushKeyCoverageService,
    {
      provide: PROJECT_DELIVERY_AUTHORIZER,
      useClass: PlatformProjectDeliveryAuthorizer
    },
    {
      provide: WEB_PUSH_TRANSPORT,
      useClass: NodeWebPushTransport
    }
  ]
})
export class WebPushWorkerModule {}
