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
import {
  sessionFamilyRevokedEventSubjectV1,
  transactionalEmailEventSubjectV1,
  transactionalEmailEventTypesV1
} from "@seo-platform/contracts";
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
    const authEmailStreamName =
      this.config.outboxPublisher.authEmailStreamName;
    const eventEnvironment = this.config.outboxPublisher.eventEnvironment;
    if (
      !streamName ||
      !authEmailStreamName ||
      !eventEnvironment ||
      !this.jetStreamManager
    ) {
      throw new Error("JetStream outbox publisher is not initialized");
    }
    if (streamName === authEmailStreamName) {
      throw new Error("JetStream outbox streams must be independent");
    }

    await this.assertStream(streamName, [
      sessionFamilyRevokedEventSubjectV1(eventEnvironment)
    ]);
    await this.assertStream(
      authEmailStreamName,
      Object.values(transactionalEmailEventTypesV1).map((eventType) =>
        transactionalEmailEventSubjectV1(eventEnvironment, eventType)
      )
    );
  }

  public async publishOutboxEvent(
    subject: string,
    payload: string,
    eventId: string,
    expectedStreamName: string
  ): Promise<PubAck> {
    if (
      !this.config.outboxPublisher.enabled ||
      !this.jetStream
    ) {
      throw new Error("JetStream outbox publisher is not initialized");
    }
    if (
      expectedStreamName !== this.config.outboxPublisher.streamName &&
      expectedStreamName !==
        this.config.outboxPublisher.authEmailStreamName
    ) {
      throw new Error("JetStream expected stream is not configured");
    }

    return this.jetStream.publish(subject, payload, {
      msgID: eventId,
      timeout: this.config.outboxPublisher.publishTimeoutMs,
      expect: { streamName: expectedStreamName }
    });
  }

  private async assertStream(
    streamName: string,
    expectedSubjects: readonly string[]
  ): Promise<void> {
    if (!this.jetStreamManager) {
      throw new Error("JetStream outbox publisher is not initialized");
    }
    const info = await this.jetStreamManager.streams.info(streamName);
    if (info.config.name !== streamName) {
      throw new Error("JetStream outbox stream identity mismatch");
    }
    const actualSubjects = info.config.subjects;
    if (
      actualSubjects?.length !== expectedSubjects.length ||
      expectedSubjects.some(
        (subject, index) => actualSubjects[index] !== subject
      )
    ) {
      throw new Error("JetStream outbox stream subject scope mismatch");
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.connection) await this.connection.drain();
    this.connection = undefined;
    this.jetStream = undefined;
    this.jetStreamManager = undefined;
  }
}
