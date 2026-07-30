import {
  Inject,
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit
} from "@nestjs/common";
import {
  connect,
  type NatsConnection
} from "@nats-io/transport-node";
import {
  jetstream,
  jetstreamManager,
  type JetStreamClient,
  type JetStreamManager,
  type PubAck
} from "@nats-io/jetstream";
import { sessionFamilyRevokedEventSubjectV1 } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

@Injectable()
export class NatsService implements OnModuleInit, OnApplicationShutdown {
  private connection: NatsConnection | undefined;
  private jetStream: JetStreamClient | undefined;
  private jetStreamManager: JetStreamManager | undefined;

  public constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public async onModuleInit(): Promise<void> {
    const connection = await connect({
      servers: this.config.nats.url,
      name: "platform-api",
      ...(this.config.nats.user ? { user: this.config.nats.user } : {}),
      ...(this.config.nats.password
        ? { pass: this.config.nats.password }
        : {})
    });
    this.connection = connection;

    if (this.config.outboxPublisher.enabled) {
      try {
        this.jetStream = jetstream(connection, {
          timeout: this.config.outboxPublisher.publishTimeoutMs
        });
        this.jetStreamManager = await jetstreamManager(connection, {
          timeout: this.config.outboxPublisher.publishTimeoutMs
        });
        await this.assertOutboxStream();
      } catch (error) {
        await connection.drain();
        this.connection = undefined;
        this.jetStream = undefined;
        this.jetStreamManager = undefined;
        throw error;
      }
    }
  }

  public async ping(): Promise<void> {
    if (!this.connection) throw new Error("NATS connection is not initialized");
    await this.connection.flush();
  }

  public async assertOutboxStream(): Promise<void> {
    if (!this.config.outboxPublisher.enabled) return;
    const streamName = this.config.outboxPublisher.streamName;
    const eventEnvironment = this.config.outboxPublisher.eventEnvironment;
    if (!streamName || !eventEnvironment || !this.jetStreamManager) {
      throw new Error("JetStream outbox publisher is not initialized");
    }

    const info = await this.jetStreamManager.streams.info(streamName);
    if (info.config.name !== streamName) {
      throw new Error("JetStream outbox stream identity mismatch");
    }
    const subject = sessionFamilyRevokedEventSubjectV1(eventEnvironment);
    if (
      info.config.subjects?.length !== 1 ||
      info.config.subjects[0] !== subject
    ) {
      throw new Error("JetStream outbox stream subject scope mismatch");
    }
  }

  public async publishOutboxEvent(
    subject: string,
    payload: string,
    eventId: string
  ): Promise<PubAck> {
    const streamName = this.config.outboxPublisher.streamName;
    if (
      !this.config.outboxPublisher.enabled ||
      !streamName ||
      !this.jetStream
    ) {
      throw new Error("JetStream outbox publisher is not initialized");
    }

    return this.jetStream.publish(subject, payload, {
      msgID: eventId,
      timeout: this.config.outboxPublisher.publishTimeoutMs,
      expect: { streamName }
    });
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.connection) await this.connection.drain();
    this.connection = undefined;
    this.jetStream = undefined;
    this.jetStreamManager = undefined;
  }
}
