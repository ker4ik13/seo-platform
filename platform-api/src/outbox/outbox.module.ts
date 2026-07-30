import { Global, Logger, Module } from "@nestjs/common";
import {
  OUTBOX_PUBLISHER_LOGGER,
  OUTBOX_PUBLISHER_SCHEDULER,
  OutboxPublisherService,
  type OutboxPublisherLogger,
  type OutboxPublisherScheduler
} from "./outbox-publisher.service.js";
import { OutboxService } from "./outbox.service.js";

const scheduler: OutboxPublisherScheduler = {
  schedule: (task, delayMs) => setTimeout(task, delayMs),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

@Global()
@Module({
  providers: [
    OutboxService,
    OutboxPublisherService,
    {
      provide: OUTBOX_PUBLISHER_SCHEDULER,
      useValue: scheduler
    },
    {
      provide: OUTBOX_PUBLISHER_LOGGER,
      useFactory: (): OutboxPublisherLogger => {
        const logger = new Logger(OutboxPublisherService.name);
        return { warn: (message) => logger.warn(message) };
      }
    }
  ],
  exports: [OutboxService]
})
export class OutboxModule {}
