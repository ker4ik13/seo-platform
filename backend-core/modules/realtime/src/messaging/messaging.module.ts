import { Global, Logger, Module } from "@nestjs/common";
import { NotificationModule } from "../notifications/notification.module.js";
import { NatsService } from "./nats.service.js";
import {
  SESSION_FAMILY_REVOCATION_CONSUMER_LOGGER,
  SessionFamilyRevocationConsumer
} from "./session-family-revocation.consumer.js";

@Global()
@Module({
  imports: [NotificationModule],
  providers: [
    NatsService,
    SessionFamilyRevocationConsumer,
    {
      provide: SESSION_FAMILY_REVOCATION_CONSUMER_LOGGER,
      useFactory: () => {
        const logger = new Logger(SessionFamilyRevocationConsumer.name);
        return { warn: (code: string) => logger.warn(code) };
      }
    }
  ],
  exports: [NatsService]
})
export class MessagingModule {}
