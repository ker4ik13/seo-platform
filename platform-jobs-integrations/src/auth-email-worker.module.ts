import { Logger, Module } from "@nestjs/common";
import {
  AUTH_EMAIL_CONSUMER_LOGGER,
  AuthEmailConsumer,
  type AuthEmailConsumerLogger
} from "./auth-email/auth-email.consumer.js";
import { AuthEmailDeliveryService } from "./auth-email/auth-email-delivery.service.js";
import { AuthEmailMaterialClient } from "./auth-email/auth-email-material.client.js";
import { AuthEmailNatsService } from "./auth-email/auth-email-nats.service.js";
import { ConfigModule } from "./config/config.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { EmailModule } from "./email/email.module.js";

@Module({
  imports: [
    ConfigModule.forRole("AUTH_EMAIL_WORKER"),
    DatabaseModule,
    EmailModule
  ],
  providers: [
    AuthEmailNatsService,
    AuthEmailMaterialClient,
    AuthEmailDeliveryService,
    AuthEmailConsumer,
    {
      provide: AUTH_EMAIL_CONSUMER_LOGGER,
      useFactory: (): AuthEmailConsumerLogger =>
        new Logger("AuthEmailWorker")
    }
  ]
})
export class AuthEmailWorkerModule {}
