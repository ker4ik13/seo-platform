import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit
} from "@nestjs/common";
import {
  parseTransactionalEmailDeadLetterEnvelopeV1,
  transactionalEmailDeadLetterSubjectV1,
  transactionalEmailEventFilterSubjectV1,
  transactionalEmailEventSubjectV1,
  transactionalEmailEventTypesV1,
  type TransactionalEmailDeadLetterEnvelopeV1
} from "@seo-platform/contracts";
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
import { connect, type NatsConnection } from "@nats-io/transport-node";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";

const SOURCE_MAX_CONSUMERS = 2;
const DLQ_MAX_CONSUMERS = 4;
const STREAM_MAX_BYTES = 512 * 1_024 * 1_024;
const SOURCE_MAX_MESSAGES = 1_000_000;
const SOURCE_MAX_MESSAGES_PER_SUBJECT = 500_000;
const SOURCE_MAX_AGE_NANOS = 30 * 24 * 60 * 60 * 1_000_000_000;
const DLQ_MAX_MESSAGES = 100_000;
const DLQ_MAX_AGE_NANOS = 60 * 24 * 60 * 60 * 1_000_000_000;
const DUPLICATE_WINDOW_NANOS = 2 * 60 * 60 * 1_000_000_000;
const EVENT_MAX_MESSAGE_SIZE_BYTES = 65_536;
const CONSUMER_ACK_WAIT_NANOS = 60 * 1_000_000_000;
const CONSUMER_MAX_ACK_PENDING = 16;
const CONSUMER_MAX_WAITING = 32;

@Injectable()
export class AuthEmailNatsService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(AuthEmailNatsService.name);
  private connection: NatsConnection | undefined;
  private jetStream: JetStreamClient | undefined;
  private manager: JetStreamManager | undefined;
  private consumer: Consumer | undefined;

  public constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public async onModuleInit(): Promise<void> {
    const eventConfig = enabledConfig(this.config);
    const connection = await connect({
      servers: this.config.nats.url,
      name: "jobs-auth-email-worker",
      ...(this.config.nats.user ? { user: this.config.nats.user } : {}),
      ...(this.config.nats.password
        ? { pass: this.config.nats.password }
        : {})
    });
    this.connection = connection;
    try {
      this.jetStream = jetstream(connection, {
        timeout: eventConfig.publishTimeoutMs
      });
      this.manager = await jetstreamManager(connection, {
        timeout: eventConfig.publishTimeoutMs
      });
      await this.assertTopology();
      this.consumer = await this.jetStream.consumers.get(
        eventConfig.streamName,
        eventConfig.durableName
      );
    } catch (error) {
      await drainWithin(
        connection,
        eventConfig.shutdownGraceMs,
        this.logger
      );
      this.clear();
      throw error;
    }
  }

  public async assertTopology(): Promise<void> {
    const eventConfig = enabledConfig(this.config);
    const manager = this.manager;
    if (!manager) throw new Error("Auth-email JetStream is not initialized");
    const [source, consumer, deadLetter] = await Promise.all([
      manager.streams.info(eventConfig.streamName),
      manager.consumers.info(
        eventConfig.streamName,
        eventConfig.durableName
      ),
      manager.streams.info(eventConfig.deadLetterStreamName)
    ]);
    assertSourceStream(source, eventConfig.environment);
    assertConsumer(consumer, eventConfig);
    assertDeadLetterStream(deadLetter, eventConfig.environment);
  }

  public async fetchMessages(): Promise<ConsumerMessages> {
    const eventConfig = enabledConfig(this.config);
    if (!this.consumer) {
      throw new Error("Auth-email JetStream consumer is not initialized");
    }
    return this.consumer.fetch({
      max_messages: 1,
      expires: eventConfig.fetchExpiresMs
    });
  }

  public isReady(): boolean {
    return Boolean(
      this.connection &&
        !this.connection.isClosed() &&
        this.jetStream &&
        this.manager &&
        this.consumer
    );
  }

  public async healthCheck(): Promise<void> {
    const connection = this.connection;
    if (!connection || !this.isReady()) {
      throw new Error("Auth-email NATS connection is unavailable");
    }
    await promiseWithin(
      connection.flush(),
      this.config.authEmail.publishTimeoutMs,
      "Auth-email NATS readiness timed out"
    );
  }

  public async publishDeadLetter(
    value: TransactionalEmailDeadLetterEnvelopeV1
  ): Promise<PubAck> {
    const eventConfig = enabledConfig(this.config);
    const jetStream = this.jetStream;
    if (!jetStream) {
      throw new Error("Auth-email JetStream consumer is not initialized");
    }
    const envelope = parseTransactionalEmailDeadLetterEnvelopeV1(value);
    const acknowledgement = await jetStream.publish(
      transactionalEmailDeadLetterSubjectV1(eventConfig.environment),
      JSON.stringify(envelope),
      {
        msgID: `jobs-auth-email-dlq-${envelope.failureId}`,
        timeout: eventConfig.publishTimeoutMs,
        expect: { streamName: eventConfig.deadLetterStreamName }
      }
    );
    if (
      acknowledgement.stream !== eventConfig.deadLetterStreamName ||
      !Number.isSafeInteger(acknowledgement.seq) ||
      acknowledgement.seq <= 0
    ) {
      throw new Error("JetStream returned an invalid auth-email DLQ PubAck");
    }
    return acknowledgement;
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.connection) {
      await drainWithin(
        this.connection,
        this.config.authEmail.shutdownGraceMs,
        this.logger
      );
    }
    this.clear();
  }

  private clear(): void {
    this.connection = undefined;
    this.jetStream = undefined;
    this.manager = undefined;
    this.consumer = undefined;
  }
}

interface EnabledAuthEmailConfig {
  readonly environment: string;
  readonly streamName: "AUTH_EMAIL_EVENTS";
  readonly durableName: "jobs_auth_email_v1";
  readonly deadLetterStreamName: "DOMAIN_EVENTS_DLQ";
  readonly fetchExpiresMs: number;
  readonly publishTimeoutMs: number;
  readonly shutdownGraceMs: number;
}

function enabledConfig(config: AppConfig): EnabledAuthEmailConfig {
  const value = config.authEmail;
  if (!value.enabled || !value.environment) {
    throw new Error("Auth-email JetStream configuration is incomplete");
  }
  return {
    environment: value.environment,
    streamName: value.streamName,
    durableName: value.durableName,
    deadLetterStreamName: value.deadLetterStreamName,
    fetchExpiresMs: value.fetchExpiresMs,
    publishTimeoutMs: value.publishTimeoutMs,
    shutdownGraceMs: value.shutdownGraceMs
  };
}

function assertSourceStream(info: StreamInfo, environment: string): void {
  const expectedSubjects = Object.values(transactionalEmailEventTypesV1).map(
    (eventType) => transactionalEmailEventSubjectV1(environment, eventType)
  );
  assertStreamBase(
    info,
    "AUTH_EMAIL_EVENTS",
    expectedSubjects,
    SOURCE_MAX_CONSUMERS,
    SOURCE_MAX_MESSAGES,
    SOURCE_MAX_AGE_NANOS,
    SOURCE_MAX_MESSAGES_PER_SUBJECT,
    "source"
  );
}

function assertDeadLetterStream(
  info: StreamInfo,
  environment: string
): void {
  assertStreamBase(
    info,
    "DOMAIN_EVENTS_DLQ",
    [
      `${environment}.dlq.realtime.identity.session-family.revoked.v1`,
      transactionalEmailDeadLetterSubjectV1(environment)
    ],
    DLQ_MAX_CONSUMERS,
    DLQ_MAX_MESSAGES,
    DLQ_MAX_AGE_NANOS,
    DLQ_MAX_MESSAGES,
    "dead-letter"
  );
}

function assertStreamBase(
  info: StreamInfo,
  expectedName: string,
  expectedSubjects: readonly string[],
  maxConsumers: number,
  maxMessages: number,
  maxAge: number,
  maxMessagesPerSubject: number,
  role: "source" | "dead-letter"
): void {
  const config = info.config;
  if (
    config.name !== expectedName ||
    !sameStringSet(config.subjects, expectedSubjects) ||
    config.storage !== StorageType.File ||
    config.retention !== RetentionPolicy.Limits ||
    config.discard !== DiscardPolicy.New ||
    config.max_consumers !== maxConsumers ||
    config.max_msgs !== maxMessages ||
    config.max_bytes !== STREAM_MAX_BYTES ||
    config.max_age !== maxAge ||
    config.max_msgs_per_subject !== maxMessagesPerSubject ||
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
    throw new Error(`Auth-email JetStream ${role} topology mismatch`);
  }
}

function assertConsumer(
  info: ConsumerInfo,
  config: EnabledAuthEmailConfig
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
    info.config.filter_subject !==
      transactionalEmailEventFilterSubjectV1(config.environment) ||
    (info.config.filter_subjects?.length ?? 0) !== 0 ||
    info.config.deliver_subject !== undefined ||
    info.config.deliver_group !== undefined ||
    info.config.flow_control === true ||
    info.config.idle_heartbeat !== undefined ||
    info.config.headers_only === true ||
    info.config.max_ack_pending !== CONSUMER_MAX_ACK_PENDING ||
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
    throw new Error("Auth-email JetStream durable consumer topology mismatch");
  }
}

function sameStringSet(
  actual: readonly string[] | undefined,
  expected: readonly string[]
): boolean {
  if (actual?.length !== expected.length) return false;
  const values = new Set(actual);
  return (
    values.size === expected.length &&
    expected.every((item) => values.has(item))
  );
}

interface DrainLogger {
  warn(code: string): void;
}

async function drainWithin(
  connection: NatsConnection,
  timeoutMs: number,
  logger: DrainLogger
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
      ? "AUTH_EMAIL_NATS_DRAIN_TIMEOUT"
      : "AUTH_EMAIL_NATS_DRAIN_FAILED"
  );
  try {
    void connection.close().catch(() => {
      logger.warn("AUTH_EMAIL_NATS_CLOSE_FAILED");
    });
  } catch {
    logger.warn("AUTH_EMAIL_NATS_CLOSE_FAILED");
  }
}

function promiseWithin<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
