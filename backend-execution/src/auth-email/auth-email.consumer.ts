import { createHash } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import {
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap
} from "@nestjs/common";
import {
  createTransactionalEmailDeadLetterEnvelopeV1,
  InvalidTransactionalEmailEventEnvelopeError,
  parseTransactionalEmailEventEnvelopeV1,
  transactionalEmailEventFilterSubjectV1,
  transactionalEmailEventSubjectV1,
  transactionalEmailEventTypesV1,
  type TransactionalEmailDeadLetterFailureCodeV1,
  type TransactionalEmailDeadLetterSourceSubjectV1,
  type TransactionalEmailEventEnvelopeV1,
  type TransactionalEmailEventSubjectV1
} from "@seo-platform/contracts";
import { canonicalizeJson } from "@seo-platform/contracts/canonical-json";
import type { ConsumerMessages, JsMsg } from "@nats-io/jetstream";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import { EMAIL, type EmailPort } from "../email/email.port.js";
import {
  AuthEmailDeliveryDeadLetterPendingError,
  AuthEmailDeliveryInvariantError,
  AuthEmailDeliveryLeaseLostError,
  AuthEmailDeliveryService
} from "./auth-email-delivery.service.js";
import { AuthEmailNatsService } from "./auth-email-nats.service.js";

export const AUTH_EMAIL_CONSUMER_LOGGER = Symbol(
  "AUTH_EMAIL_CONSUMER_LOGGER"
);
export const AUTH_EMAIL_READY_FILE =
  "/tmp/seo-platform-auth-email-worker.ready";
const READINESS_PROBE_INTERVAL_MS = 30_000;

export interface AuthEmailConsumerLogger {
  log(code: string): void;
  warn(code: string): void;
}

@Injectable()
export class AuthEmailConsumer
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private stopping = false;
  private acknowledgementsAbandoned = false;
  private stopController = new AbortController();
  private activeRun: Promise<void> | undefined;
  private activeIteration: Promise<boolean> | undefined;
  private activeMessages: ConsumerMessages | undefined;
  private activeDispatch: Promise<void> | undefined;
  private dispatchTimer: ReturnType<typeof setInterval> | undefined;
  private readinessTimer: ReturnType<typeof setInterval> | undefined;
  private activeReadinessCheck: Promise<void> | undefined;
  private processingReady = false;
  private smtpVerified = false;

  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly nats: AuthEmailNatsService,
    private readonly deliveries: AuthEmailDeliveryService,
    private readonly prisma: PrismaService,
    @Inject(EMAIL) private readonly email: EmailPort,
    @Inject(AUTH_EMAIL_CONSUMER_LOGGER)
    private readonly logger: AuthEmailConsumerLogger
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    this.stopping = false;
    this.acknowledgementsAbandoned = false;
    this.processingReady = false;
    this.smtpVerified = false;
    this.stopController = new AbortController();
    await removeReadyFile(this.logger);
    await this.refreshReadiness();
    const run = this.consumeLoop();
    this.activeRun = run;
    void run.then(
      () => this.clearActiveRun(run),
      () => {
        this.logger.warn("AUTH_EMAIL_CONSUMER_LOOP_STOPPED");
        this.clearActiveRun(run);
      }
    );
    void this.dispatchDue();
    this.dispatchTimer = setInterval(
      () => void this.dispatchDue(),
      this.config.authEmail.dispatchMs
    );
    this.dispatchTimer.unref();
    this.readinessTimer = setInterval(
      () => void this.refreshReadiness(),
      READINESS_PROBE_INTERVAL_MS
    );
    this.readinessTimer.unref();
    this.logger.log("AUTH_EMAIL_WORKER_STARTED");
  }

  public async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.processingReady = false;
    this.stopController.abort();
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
    if (this.readinessTimer) clearInterval(this.readinessTimer);
    await removeReadyFile(this.logger);
    const pending: Promise<unknown>[] = [];
    if (this.activeMessages) {
      pending.push(
        this.activeMessages.close().catch(() => {
          this.logger.warn("AUTH_EMAIL_CONSUMER_FETCH_CLOSE_FAILED");
        })
      );
    }
    if (this.activeIteration) pending.push(this.activeIteration);
    if (this.activeRun) pending.push(this.activeRun);
    if (this.activeDispatch) pending.push(this.activeDispatch);
    if (this.activeReadinessCheck) pending.push(this.activeReadinessCheck);
    if (
      !(await settleWithin(
        pending,
        this.config.authEmail.shutdownGraceMs,
        () => {
          this.acknowledgementsAbandoned = true;
        }
      ))
    ) {
      this.logger.warn("AUTH_EMAIL_CONSUMER_SHUTDOWN_TIMEOUT");
    }
  }

  public runOnce(): Promise<boolean> {
    if (this.stopping || !this.processingReady) return Promise.resolve(false);
    if (this.activeIteration) return this.activeIteration;
    const iteration = this.consumeOneFetch();
    this.activeIteration = iteration;
    const clear = (): void => {
      if (this.activeIteration === iteration) {
        this.activeIteration = undefined;
      }
    };
    void iteration.then(clear, clear);
    return iteration;
  }

  public async processMessage(message: JsMsg): Promise<void> {
    const eventConfig = enabledConfig(this.config);
    if (!sourceMetadataMatches(message, eventConfig)) {
      await this.deadLetter(message, "SOURCE_METADATA_MISMATCH");
      return;
    }
    if (!isExactSourceSubject(safeMessageSubject(message), eventConfig)) {
      await this.deadLetter(message, "SOURCE_SUBJECT_MISMATCH");
      return;
    }

    const data = safeMessageData(message);
    if (!data) {
      await this.deadLetter(message, "PAYLOAD_INVALID_ENCODING");
      return;
    }
    if (data.byteLength > eventConfig.maxPayloadBytes) {
      await this.deadLetter(message, "PAYLOAD_TOO_LARGE");
      return;
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      await this.deadLetter(message, "PAYLOAD_INVALID_ENCODING");
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(text) as unknown;
    } catch {
      await this.deadLetter(message, "PAYLOAD_INVALID_JSON");
      return;
    }
    let event: TransactionalEmailEventEnvelopeV1;
    try {
      event = parseTransactionalEmailEventEnvelopeV1(decoded);
    } catch (error) {
      if (error instanceof InvalidTransactionalEmailEventEnvelopeError) {
        await this.deadLetter(message, "EVENT_SCHEMA_INVALID");
        return;
      }
      throw error;
    }
    if (
      safeMessageSubject(message) !==
      transactionalEmailEventSubjectV1(
        eventConfig.environment,
        event.eventType
      )
    ) {
      await this.deadLetter(message, "SOURCE_SUBJECT_MISMATCH");
      return;
    }

    try {
      const result = await this.deliveries.processEvent(
        event,
        createHash("sha256")
          .update(canonicalizeJson(event))
          .digest()
      );
      if (result.disposition === "BUSY") {
        if (!this.acknowledgementsAbandoned) {
          safeNak(
            message,
            result.retryDelayMs ?? eventConfig.retryBaseMs
          );
        }
        return;
      }
    } catch (error) {
      if (error instanceof AuthEmailDeliveryInvariantError) {
        await this.deadLetter(message, "EVENT_SCHEMA_INVALID");
        return;
      }
      if (
        error instanceof AuthEmailDeliveryDeadLetterPendingError ||
        error instanceof AuthEmailDeliveryLeaseLostError
      ) {
        if (!this.acknowledgementsAbandoned) {
          safeNak(
            message,
            processingRetryDelayMs(
              message,
              safeDeliveryAttempt(message),
              eventConfig
            )
          );
        }
        return;
      }
      const attempt = safeDeliveryAttempt(message);
      if (attempt >= eventConfig.maxAttempts) {
        await this.deadLetter(
          message,
          "PROCESSING_ATTEMPTS_EXHAUSTED"
        );
        return;
      }
      if (!this.acknowledgementsAbandoned) {
        safeNak(
          message,
          processingRetryDelayMs(message, attempt, eventConfig)
        );
      }
      return;
    }

    if (this.acknowledgementsAbandoned) return;
    await acknowledgeSource(message, eventConfig.publishTimeoutMs);
  }

  private async consumeLoop(): Promise<void> {
    while (!this.stopping) {
      if (!this.processingReady) {
        await interruptibleWait(
          this.config.authEmail.retryBaseMs,
          this.stopController.signal
        );
        continue;
      }
      try {
        await this.runOnce();
      } catch {
        if (this.stopping) break;
        this.logger.warn("AUTH_EMAIL_CONSUMER_ITERATION_FAILED");
        await interruptibleWait(
          this.config.authEmail.retryBaseMs,
          this.stopController.signal
        );
      }
    }
  }

  private async consumeOneFetch(): Promise<boolean> {
    const messages = await this.nats.fetchMessages();
    this.activeMessages = messages;
    try {
      for await (const message of messages) {
        if (this.stopping) return false;
        if (!this.processingReady) {
          safeNak(message, this.config.authEmail.retryBaseMs);
          return false;
        }
        await this.processMessage(message);
        return true;
      }
      return false;
    } finally {
      if (this.activeMessages === messages) this.activeMessages = undefined;
      await messages.close();
    }
  }

  private dispatchDue(): Promise<void> {
    if (this.stopping || !this.processingReady) return Promise.resolve();
    if (this.activeDispatch) return this.activeDispatch;
    const dispatch = this.dispatchDueOnce();
    this.activeDispatch = dispatch;
    const clear = (): void => {
      if (this.activeDispatch === dispatch) this.activeDispatch = undefined;
    };
    void dispatch.then(clear, clear);
    return dispatch;
  }

  private async dispatchDueOnce(): Promise<void> {
    try {
      const ids = await this.deliveries.pendingAttemptIds();
      for (const id of ids) {
        if (this.stopping) return;
        try {
          await this.deliveries.processAttempt(id);
        } catch (error) {
          this.logger.warn(
            error instanceof AuthEmailDeliveryDeadLetterPendingError
              ? "AUTH_EMAIL_DELIVERY_DLQ_PENDING"
              : "AUTH_EMAIL_DELIVERY_DISPATCH_FAILED"
          );
        }
      }
    } catch {
      this.logger.warn("AUTH_EMAIL_DELIVERY_SCAN_FAILED");
    }
  }

  private async deadLetter(
    message: JsMsg,
    failureCode: TransactionalEmailDeadLetterFailureCodeV1
  ): Promise<void> {
    if (this.acknowledgementsAbandoned) return;
    const eventConfig = enabledConfig(this.config);
    const envelope = deadLetterEnvelope(
      message,
      failureCode,
      eventConfig
    );
    let published = false;
    try {
      await this.nats.publishDeadLetter(envelope);
      published = true;
      if (this.acknowledgementsAbandoned) return;
      await acknowledgeSource(message, eventConfig.publishTimeoutMs);
    } catch {
      this.logger.warn("AUTH_EMAIL_CONSUMER_DEAD_LETTER_OR_ACK_FAILED");
      if (!this.stopping && !published) {
        safeNak(
          message,
          processingRetryDelayMs(
            message,
            safeDeliveryAttempt(message),
            eventConfig
          )
        );
      }
    }
  }

  private clearActiveRun(run: Promise<void>): void {
    if (this.activeRun === run) this.activeRun = undefined;
  }

  private refreshReadiness(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.activeReadinessCheck) return this.activeReadinessCheck;
    const check = this.checkReadiness();
    this.activeReadinessCheck = check;
    const clear = (): void => {
      if (this.activeReadinessCheck === check) {
        this.activeReadinessCheck = undefined;
      }
    };
    void check.then(clear, clear);
    return check;
  }

  private async checkReadiness(): Promise<void> {
    try {
      await this.prisma.ping();
      await this.nats.healthCheck();
      if (!this.smtpVerified) {
        await this.email.healthCheck();
        this.smtpVerified = true;
      }
      if (this.stopping) return;
      await writeFile(AUTH_EMAIL_READY_FILE, "ready\n", {
        encoding: "utf8",
        mode: 0o600
      });
      if (this.stopping) {
        await removeReadyFile(this.logger);
        return;
      }
      if (!this.processingReady) {
        this.logger.log("AUTH_EMAIL_WORKER_READY");
      }
      this.processingReady = true;
    } catch {
      this.processingReady = false;
      await removeReadyFile(this.logger);
      if (!this.stopping) {
        this.logger.warn("AUTH_EMAIL_WORKER_DEGRADED");
      }
    }
  }
}

interface EnabledConsumerConfig {
  readonly environment: string;
  readonly streamName: string;
  readonly durableName: string;
  readonly maxAttempts: number;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
  readonly publishTimeoutMs: number;
  readonly maxPayloadBytes: number;
}

function enabledConfig(config: AppConfig): EnabledConsumerConfig {
  const value = config.authEmail;
  if (!value.enabled || !value.environment) {
    throw new Error("Auth-email event consumer configuration is incomplete");
  }
  return {
    environment: value.environment,
    streamName: value.streamName,
    durableName: value.durableName,
    maxAttempts: value.maxAttempts,
    retryBaseMs: value.retryBaseMs,
    retryMaxMs: value.retryMaxMs,
    publishTimeoutMs: value.publishTimeoutMs,
    maxPayloadBytes: value.maxPayloadBytes
  };
}

function sourceMetadataMatches(
  message: JsMsg,
  config: EnabledConsumerConfig
): boolean {
  try {
    const info = message.info;
    return (
      info.stream === config.streamName &&
      info.consumer === config.durableName &&
      Number.isSafeInteger(info.streamSequence) &&
      info.streamSequence > 0 &&
      Number.isSafeInteger(info.deliveryCount) &&
      info.deliveryCount > 0
    );
  } catch {
    return false;
  }
}

function isExactSourceSubject(
  subject: string | undefined,
  config: EnabledConsumerConfig
): boolean {
  return Object.values(transactionalEmailEventTypesV1).some(
    (eventType) =>
      subject ===
      transactionalEmailEventSubjectV1(config.environment, eventType)
  );
}

function safeMessageSubject(message: JsMsg): string | undefined {
  try {
    return typeof message.subject === "string" ? message.subject : undefined;
  } catch {
    return undefined;
  }
}

function safeMessageData(message: JsMsg): Uint8Array | undefined {
  try {
    return message.data instanceof Uint8Array ? message.data : undefined;
  } catch {
    return undefined;
  }
}

function safeDeliveryAttempt(message: JsMsg): number {
  try {
    const attempt = message.info.deliveryCount;
    if (Number.isSafeInteger(attempt) && attempt > 0) return attempt;
  } catch {
    // Missing metadata is handled by sourceMetadataMatches before delivery.
  }
  return 1;
}

function safeStreamSequence(message: JsMsg): number | undefined {
  try {
    const sequence = message.info.streamSequence;
    if (Number.isSafeInteger(sequence) && sequence > 0) return sequence;
  } catch {
    // The bounded payload hash below is a deterministic fallback.
  }
  try {
    if (Number.isSafeInteger(message.seq) && message.seq > 0) {
      return message.seq;
    }
  } catch {
    // The bounded payload hash below is a deterministic fallback.
  }
  return undefined;
}

function deadLetterEnvelope(
  message: JsMsg,
  failureCode: TransactionalEmailDeadLetterFailureCodeV1,
  config: EnabledConsumerConfig
) {
  const data = safeMessageData(message) ?? new Uint8Array();
  const streamSequence = safeStreamSequence(message);
  const messageReference =
    streamSequence === undefined
      ? (`sha256:${createHash("sha256").update(data).digest("hex")}` as const)
      : (`stream-sequence:${streamSequence}` as const);
  const failureId = createHash("sha256")
    .update("jobs-auth-email-source-dlq-v1\0")
    .update(config.streamName)
    .update("\0")
    .update(config.durableName)
    .update("\0")
    .update(messageReference)
    .update("\0")
    .update(failureCode)
    .digest("hex");
  return createTransactionalEmailDeadLetterEnvelopeV1({
    failureId,
    failureCode,
    sourceStream: config.streamName,
    sourceConsumer: config.durableName,
    sourceSubject: deadLetterSourceSubject(message, config),
    messageReference
  });
}

function deadLetterSourceSubject(
  message: JsMsg,
  config: EnabledConsumerConfig
): TransactionalEmailDeadLetterSourceSubjectV1 {
  const subject = safeMessageSubject(message);
  if (isExactSourceSubject(subject, config)) {
    return subject as TransactionalEmailEventSubjectV1;
  }
  return transactionalEmailEventFilterSubjectV1(config.environment);
}

function processingRetryDelayMs(
  message: JsMsg,
  attempt: number,
  config: Pick<EnabledConsumerConfig, "retryBaseMs" | "retryMaxMs">
): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 30);
  const exponential = Math.min(
    config.retryMaxMs,
    config.retryBaseMs * 2 ** exponent
  );
  const jitterRange = Math.max(1, Math.floor(exponential * 0.2));
  const data = safeMessageData(message) ?? new Uint8Array();
  const seed = createHash("sha256")
    .update("jobs-auth-email-source-retry-v1\0")
    .update(data)
    .update(String(attempt))
    .digest()
    .readUInt32BE(0);
  const jitter = (seed % (jitterRange * 2 + 1)) - jitterRange;
  return Math.max(1, Math.min(config.retryMaxMs, exponential + jitter));
}

function safeNak(message: JsMsg, delayMs: number): void {
  try {
    message.nak(delayMs);
  } catch {
    // An unacknowledged source remains eligible for server-side redelivery.
  }
}

async function acknowledgeSource(
  message: JsMsg,
  timeoutMs: number
): Promise<void> {
  const acknowledged = await message.ackAck({ timeout: timeoutMs });
  if (!acknowledged) {
    throw new Error("JetStream did not confirm auth-email source ACK");
  }
}

function interruptibleWait(
  delayMs: number,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, delayMs);
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

function settleWithin(
  pending: readonly Promise<unknown>[],
  timeoutMs: number,
  onTimeout: () => void
): Promise<boolean> {
  if (pending.length === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    let finished = false;
    const finish = (settled: boolean): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(settled);
    };
    const timer = setTimeout(() => {
      onTimeout();
      finish(false);
    }, timeoutMs);
    void Promise.allSettled(pending).then(() => finish(true));
  });
}

async function removeReadyFile(
  logger: AuthEmailConsumerLogger
): Promise<void> {
  try {
    await unlink(AUTH_EMAIL_READY_FILE);
  } catch (error) {
    if (!isMissingFile(error)) {
      logger.warn("AUTH_EMAIL_READY_FILE_REMOVE_FAILED");
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
