import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit
} from "@nestjs/common";
import {
  connect,
  type NatsConnection
} from "@nats-io/transport-node";
import {
  AckPolicy,
  DeliverPolicy,
  DiscardPolicy,
  jetstream,
  jetstreamManager,
  RetentionPolicy,
  ReplayPolicy,
  StorageType,
  type Consumer,
  type ConsumerInfo,
  type ConsumerMessages,
  type JetStreamClient,
  type JetStreamManager,
  type PubAck,
  type StreamInfo
} from "@nats-io/jetstream";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

interface EnabledEventConsumerConfig {
  readonly environment: string;
  readonly streamName: string;
  readonly durableName: string;
  readonly subject: string;
  readonly deadLetterStreamName: string;
  readonly deadLetterSubject: string;
  readonly fetchExpiresMs: number;
  readonly publishTimeoutMs: number;
}

const STREAM_MAX_CONSUMERS = 4;
const STREAM_MAX_BYTES = 512 * 1024 * 1024;
const SOURCE_MAX_MESSAGES = 1_000_000;
const SOURCE_MAX_AGE_NANOS = 30 * 24 * 60 * 60 * 1_000_000_000;
const DEAD_LETTER_MAX_MESSAGES = 100_000;
const DEAD_LETTER_MAX_AGE_NANOS =
  60 * 24 * 60 * 60 * 1_000_000_000;
const DUPLICATE_WINDOW_NANOS = 2 * 60 * 60 * 1_000_000_000;
const EVENT_MAX_MESSAGE_SIZE_BYTES = 65_536;
const CONSUMER_ACK_WAIT_NANOS = 60 * 1_000_000_000;
const CONSUMER_MAX_WAITING = 32;

@Injectable()
export class NatsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NatsService.name);
  private connection: NatsConnection | undefined;
  private jetStream: JetStreamClient | undefined;
  private jetStreamManager: JetStreamManager | undefined;
  private eventConsumer: Consumer | undefined;

  public constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public async onModuleInit(): Promise<void> {
    const connection = await connect({
      servers: this.config.nats.url,
      name: "realtime",
      ...(this.config.nats.user ? { user: this.config.nats.user } : {}),
      ...(this.config.nats.password
        ? { pass: this.config.nats.password }
        : {})
    });
    this.connection = connection;

    if (!this.config.eventConsumer.enabled) return;
    const eventConfig = this.enabledEventConfig();
    try {
      this.jetStream = jetstream(connection, {
        timeout: eventConfig.publishTimeoutMs
      });
      this.jetStreamManager = await jetstreamManager(connection, {
        timeout: eventConfig.publishTimeoutMs
      });
      await this.assertEventConsumerTopology();
      this.eventConsumer = await this.jetStream.consumers.get(
        eventConfig.streamName,
        eventConfig.durableName
      );
    } catch (error) {
      await drainConnectionWithin(
        connection,
        this.config.eventConsumer.shutdownGraceMs,
        this.logger
      );
      this.clear();
      throw error;
    }
  }

  public async ping(): Promise<void> {
    if (!this.connection) throw new Error("NATS connection is not initialized");
    await this.connection.flush();
    await this.assertEventConsumerTopology();
  }

  public async assertEventConsumerTopology(): Promise<void> {
    if (!this.config.eventConsumer.enabled) return;
    const eventConfig = this.enabledEventConfig();
    const manager = this.jetStreamManager;
    if (!manager) {
      throw new Error("JetStream event consumer is not initialized");
    }

    const [sourceStream, consumer, deadLetterStream] = await Promise.all([
      manager.streams.info(eventConfig.streamName),
      manager.consumers.info(
        eventConfig.streamName,
        eventConfig.durableName
      ),
      manager.streams.info(eventConfig.deadLetterStreamName)
    ]);

    assertExactStream(
      sourceStream,
      eventConfig.streamName,
      [eventConfig.subject],
      "source"
    );
    assertExactConsumer(consumer, eventConfig);
    assertExactStream(
      deadLetterStream,
      eventConfig.deadLetterStreamName,
      [
        eventConfig.deadLetterSubject,
        `${eventConfig.environment}.dlq.jobs.transactional-email.v1`
      ],
      "dead-letter"
    );
  }

  public async fetchEventMessages(): Promise<ConsumerMessages> {
    const eventConfig = this.enabledEventConfig();
    if (!this.eventConsumer) {
      throw new Error("JetStream event consumer is not initialized");
    }
    return this.eventConsumer.fetch({
      max_messages: 1,
      expires: eventConfig.fetchExpiresMs
    });
  }

  public async publishDeadLetter(
    payload: string,
    messageId: string
  ): Promise<PubAck> {
    const eventConfig = this.enabledEventConfig();
    if (!this.jetStream) {
      throw new Error("JetStream event consumer is not initialized");
    }
    const acknowledgement = await this.jetStream.publish(
      eventConfig.deadLetterSubject,
      payload,
      {
        msgID: messageId,
        timeout: eventConfig.publishTimeoutMs,
        expect: { streamName: eventConfig.deadLetterStreamName }
      }
    );
    if (
      acknowledgement.stream !== eventConfig.deadLetterStreamName ||
      !Number.isSafeInteger(acknowledgement.seq) ||
      acknowledgement.seq <= 0
    ) {
      throw new Error("JetStream returned an invalid dead-letter PubAck");
    }
    return acknowledgement;
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.connection) {
      await drainConnectionWithin(
        this.connection,
        this.config.eventConsumer.shutdownGraceMs,
        this.logger
      );
    }
    this.clear();
  }

  private enabledEventConfig(): EnabledEventConsumerConfig {
    const config = this.config.eventConsumer;
    if (
      !config.enabled ||
      !config.environment ||
      !config.streamName ||
      !config.durableName ||
      !config.subject ||
      !config.deadLetterStreamName ||
      !config.deadLetterSubject
    ) {
      throw new Error("JetStream event consumer configuration is incomplete");
    }
    return {
      environment: config.environment,
      streamName: config.streamName,
      durableName: config.durableName,
      subject: config.subject,
      deadLetterStreamName: config.deadLetterStreamName,
      deadLetterSubject: config.deadLetterSubject,
      fetchExpiresMs: config.fetchExpiresMs,
      publishTimeoutMs: config.publishTimeoutMs
    };
  }

  private clear(): void {
    this.connection = undefined;
    this.jetStream = undefined;
    this.jetStreamManager = undefined;
    this.eventConsumer = undefined;
  }
}

function assertExactStream(
  info: StreamInfo,
  expectedName: string,
  expectedSubjects: readonly string[],
  role: "source" | "dead-letter"
): void {
  const config = info.config;
  const expectedMessages =
    role === "source" ? SOURCE_MAX_MESSAGES : DEAD_LETTER_MAX_MESSAGES;
  const expectedAge =
    role === "source" ? SOURCE_MAX_AGE_NANOS : DEAD_LETTER_MAX_AGE_NANOS;
  if (
    config.name !== expectedName ||
    !hasExactSubjects(config.subjects, expectedSubjects) ||
    config.storage !== StorageType.File ||
    config.retention !== RetentionPolicy.Limits ||
    config.discard !== DiscardPolicy.New ||
    config.max_consumers !== STREAM_MAX_CONSUMERS ||
    config.max_msgs !== expectedMessages ||
    config.max_bytes !== STREAM_MAX_BYTES ||
    config.max_age !== expectedAge ||
    config.max_msgs_per_subject !== expectedMessages ||
    config.num_replicas !== 1 ||
    config.no_ack === true ||
    config.deny_delete !== true ||
    config.deny_purge !== true ||
    config.allow_direct === true ||
    config.allow_rollup_hdrs === true ||
    config.discard_new_per_subject === true ||
    config.sealed === true ||
    config.max_msg_size !== EVENT_MAX_MESSAGE_SIZE_BYTES ||
    config.duplicate_window !== DUPLICATE_WINDOW_NANOS ||
    config.republish !== undefined ||
    config.subject_transform !== undefined ||
    config.mirror !== undefined ||
    (config.sources?.length ?? 0) !== 0
  ) {
    throw new Error(`JetStream ${role} stream topology mismatch`);
  }
}

function assertExactConsumer(
  info: ConsumerInfo,
  config: EnabledEventConsumerConfig
): void {
  const maximumFetchExpiration = info.config.max_expires;
  const inactiveThreshold = info.config.inactive_threshold;
  if (
    info.stream_name !== config.streamName ||
    info.name !== config.durableName ||
    info.paused === true ||
    info.config.durable_name !== config.durableName ||
    (info.config.name !== undefined &&
      info.config.name !== config.durableName) ||
    info.config.ack_policy !== AckPolicy.Explicit ||
    info.config.deliver_policy !== DeliverPolicy.All ||
    info.config.replay_policy !== ReplayPolicy.Instant ||
    info.config.ack_wait !== CONSUMER_ACK_WAIT_NANOS ||
    info.config.backoff !== undefined ||
    info.config.filter_subject !== config.subject ||
    (info.config.filter_subjects?.length ?? 0) !== 0 ||
    info.config.deliver_subject !== undefined ||
    info.config.deliver_group !== undefined ||
    info.config.flow_control === true ||
    info.config.idle_heartbeat !== undefined ||
    info.config.headers_only === true ||
    info.config.max_ack_pending !== 1 ||
    info.config.max_waiting !== CONSUMER_MAX_WAITING ||
    (maximumFetchExpiration !== undefined &&
      (maximumFetchExpiration < 0 ||
        (maximumFetchExpiration > 0 &&
          maximumFetchExpiration < config.fetchExpiresMs * 1_000_000))) ||
    (inactiveThreshold !== undefined && inactiveThreshold !== 0) ||
    info.config.max_deliver !== -1 ||
    info.config.num_replicas !== 1 ||
    info.config.mem_storage === true ||
    info.config.pause_until !== undefined ||
    info.config.opt_start_seq !== undefined ||
    info.config.opt_start_time !== undefined ||
    info.config.rate_limit_bps !== undefined
  ) {
    throw new Error("JetStream durable consumer topology mismatch");
  }
}

function hasExactSubjects(
  patterns: readonly string[] | undefined,
  expected: readonly string[]
): boolean {
  return (
    patterns?.length === expected.length &&
    new Set(patterns).size === patterns.length &&
    expected.every((subject) => patterns.includes(subject))
  );
}

interface NatsDrainLogger {
  warn(code: string): void;
}

async function drainConnectionWithin(
  connection: NatsConnection,
  timeoutMs: number,
  logger: NatsDrainLogger
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const drain = Promise.resolve()
    .then(() => connection.drain())
    .then(
      () => "drained" as const,
      () => "failed" as const
    );
  const result = await Promise.race([drain, timeout]);
  if (timer) clearTimeout(timer);
  if (result === "drained") return;

  logger.warn(
    result === "timeout"
      ? "NATS_CONNECTION_DRAIN_TIMEOUT"
      : "NATS_CONNECTION_DRAIN_FAILED"
  );
  try {
    void connection.close().catch(() => {
      logger.warn("NATS_CONNECTION_CLOSE_FAILED");
    });
  } catch {
    logger.warn("NATS_CONNECTION_CLOSE_FAILED");
  }
}
