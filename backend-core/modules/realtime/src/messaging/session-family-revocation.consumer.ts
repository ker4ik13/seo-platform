import { createHash } from "node:crypto";
import {
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap
} from "@nestjs/common";
import {
  InvalidSessionFamilyRevokedEventEnvelopeError,
  parseSessionFamilyRevokedEventEnvelopeV1,
  type SessionFamilyRevokedEventEnvelopeV1
} from "@seo-platform/contracts";
import type {
  ConsumerMessages,
  JsMsg
} from "@nats-io/jetstream";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import {
  SessionFamilyRevocationInvariantError,
  SessionFamilyRevocationService
} from "../notifications/session-family-revocation.service.js";
import { NatsService } from "./nats.service.js";

export const SESSION_FAMILY_REVOCATION_CONSUMER_LOGGER = Symbol(
  "SESSION_FAMILY_REVOCATION_CONSUMER_LOGGER"
);

export interface SessionFamilyRevocationConsumerLogger {
  warn(code: string): void;
}

type DeadLetterFailureCode =
  | "SOURCE_METADATA_MISMATCH"
  | "SOURCE_SUBJECT_MISMATCH"
  | "PAYLOAD_TOO_LARGE"
  | "PAYLOAD_INVALID_ENCODING"
  | "PAYLOAD_INVALID_JSON"
  | "EVENT_SCHEMA_INVALID"
  | "EVENT_INVARIANT_VIOLATION"
  | "PROCESSING_ATTEMPTS_EXHAUSTED";

interface DeadLetterEnvelope {
  readonly schemaVersion: 1;
  readonly failureId: string;
  readonly failureCode: DeadLetterFailureCode;
  readonly source: {
    readonly stream: string;
    readonly consumer: string;
    readonly subject: string;
    readonly messageReference: string;
  };
}

@Injectable()
export class SessionFamilyRevocationConsumer
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private stopping = false;
  private acknowledgementsAbandoned = false;
  private stopController = new AbortController();
  private activeRun: Promise<void> | undefined;
  private activeIteration: Promise<boolean> | undefined;
  private activeMessages: ConsumerMessages | undefined;

  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly nats: NatsService,
    private readonly handler: SessionFamilyRevocationService,
    @Inject(SESSION_FAMILY_REVOCATION_CONSUMER_LOGGER)
    private readonly logger: SessionFamilyRevocationConsumerLogger
  ) {}

  public onApplicationBootstrap(): void {
    if (!this.config.eventConsumer.enabled) return;
    this.stopping = false;
    this.acknowledgementsAbandoned = false;
    this.stopController = new AbortController();
    const run = this.consumeLoop();
    this.activeRun = run;
    void run.then(
      () => this.clearActiveRun(run),
      () => {
        this.logger.warn("SESSION_REVOCATION_CONSUMER_LOOP_STOPPED");
        this.clearActiveRun(run);
      }
    );
  }

  public async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.stopController.abort();
    const pending: Promise<unknown>[] = [];
    if (this.activeMessages) {
      pending.push(
        this.activeMessages.close().catch(() => {
          this.logger.warn(
            "SESSION_REVOCATION_CONSUMER_FETCH_CLOSE_FAILED"
          );
        })
      );
    }
    if (this.activeIteration) pending.push(this.activeIteration);
    if (this.activeRun) pending.push(this.activeRun);
    if (
      !(await settleWithin(
        pending,
        this.config.eventConsumer.shutdownGraceMs,
        () => {
          this.acknowledgementsAbandoned = true;
        }
      ))
    ) {
      this.logger.warn("SESSION_REVOCATION_CONSUMER_SHUTDOWN_TIMEOUT");
    }
  }

  public runOnce(): Promise<boolean> {
    if (!this.config.eventConsumer.enabled || this.stopping) {
      return Promise.resolve(false);
    }
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
    const eventConfig = enabledEventConfig(this.config);
    if (!sourceMetadataMatches(message, eventConfig)) {
      await this.deadLetter(message, "SOURCE_METADATA_MISMATCH");
      return;
    }
    if (safeMessageSubject(message) !== eventConfig.subject) {
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

    let event: SessionFamilyRevokedEventEnvelopeV1;
    try {
      event = parseSessionFamilyRevokedEventEnvelopeV1(decoded);
    } catch (error) {
      if (error instanceof InvalidSessionFamilyRevokedEventEnvelopeError) {
        await this.deadLetter(message, "EVENT_SCHEMA_INVALID");
        return;
      }
      throw error;
    }

    try {
      await this.handler.handle(event);
    } catch (error) {
      if (error instanceof SessionFamilyRevocationInvariantError) {
        await this.deadLetter(message, "EVENT_INVARIANT_VIOLATION");
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
        safeNak(message, retryDelayMs(message, attempt, eventConfig));
      }
      return;
    }

    if (this.acknowledgementsAbandoned) return;
    await acknowledgeSource(message, eventConfig.publishTimeoutMs);
  }

  private async consumeLoop(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.runOnce();
      } catch {
        if (this.stopping) break;
        this.logger.warn("SESSION_REVOCATION_CONSUMER_ITERATION_FAILED");
        await interruptibleWait(
          this.config.eventConsumer.retryBaseMs,
          this.stopController.signal
        );
      }
    }
  }

  private async consumeOneFetch(): Promise<boolean> {
    const messages = await this.nats.fetchEventMessages();
    this.activeMessages = messages;
    try {
      for await (const message of messages) {
        if (this.stopping) return false;
        await this.processMessage(message);
        return true;
      }
      return false;
    } finally {
      if (this.activeMessages === messages) {
        this.activeMessages = undefined;
      }
      await messages.close();
    }
  }

  private async deadLetter(
    message: JsMsg,
    failureCode: DeadLetterFailureCode
  ): Promise<void> {
    if (this.acknowledgementsAbandoned) return;
    const eventConfig = enabledEventConfig(this.config);
    const envelope = deadLetterEnvelope(message, failureCode, eventConfig);
    let published = false;
    try {
      await this.nats.publishDeadLetter(
        JSON.stringify(envelope),
        `realtime-dlq-${envelope.failureId}`
      );
      published = true;
      if (this.acknowledgementsAbandoned) return;
      await acknowledgeSource(message, eventConfig.publishTimeoutMs);
    } catch {
      this.logger.warn(
        "SESSION_REVOCATION_CONSUMER_DEAD_LETTER_OR_ACK_FAILED"
      );
      if (!this.stopping && !published) {
        safeNak(
          message,
          retryDelayMs(
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
}

interface EnabledEventConfig {
  readonly streamName: string;
  readonly durableName: string;
  readonly subject: string;
  readonly maxAttempts: number;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
  readonly publishTimeoutMs: number;
  readonly maxPayloadBytes: number;
}

function enabledEventConfig(config: AppConfig): EnabledEventConfig {
  const eventConfig = config.eventConsumer;
  if (
    !eventConfig.enabled ||
    !eventConfig.streamName ||
    !eventConfig.durableName ||
    !eventConfig.subject
  ) {
    throw new Error("JetStream event consumer configuration is incomplete");
  }
  return {
    streamName: eventConfig.streamName,
    durableName: eventConfig.durableName,
    subject: eventConfig.subject,
    maxAttempts: eventConfig.maxAttempts,
    retryBaseMs: eventConfig.retryBaseMs,
    retryMaxMs: eventConfig.retryMaxMs,
    publishTimeoutMs: eventConfig.publishTimeoutMs,
    maxPayloadBytes: eventConfig.maxPayloadBytes
  };
}

function sourceMetadataMatches(
  message: JsMsg,
  config: EnabledEventConfig
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
    const deliveryCount = message.info.deliveryCount;
    if (Number.isSafeInteger(deliveryCount) && deliveryCount > 0) {
      return deliveryCount;
    }
  } catch {
    // Missing or malformed delivery metadata falls back to the first attempt.
  }
  return 1;
}

function safeStreamSequence(message: JsMsg): number | undefined {
  try {
    const sequence = message.info.streamSequence;
    if (Number.isSafeInteger(sequence) && sequence > 0) return sequence;
  } catch {
    // The payload digest below remains deterministic without metadata.
  }
  try {
    if (Number.isSafeInteger(message.seq) && message.seq > 0) {
      return message.seq;
    }
  } catch {
    // The payload digest below remains deterministic without metadata.
  }
  return undefined;
}

function deadLetterEnvelope(
  message: JsMsg,
  failureCode: DeadLetterFailureCode,
  config: EnabledEventConfig
): DeadLetterEnvelope {
  const data = safeMessageData(message) ?? new Uint8Array();
  const streamSequence = safeStreamSequence(message);
  const messageReference =
    streamSequence === undefined
      ? `sha256:${createHash("sha256").update(data).digest("hex")}`
      : `stream-sequence:${streamSequence}`;
  const failureId = createHash("sha256")
    .update("realtime-session-family-revocation-dlq-v1\0")
    .update(config.streamName)
    .update("\0")
    .update(config.durableName)
    .update("\0")
    .update(messageReference)
    .update("\0")
    .update(failureCode)
    .digest("hex");
  return {
    schemaVersion: 1,
    failureId,
    failureCode,
    source: {
      stream: config.streamName,
      consumer: config.durableName,
      subject: config.subject,
      messageReference
    }
  };
}

function retryDelayMs(
  message: JsMsg,
  attempt: number,
  config: Pick<EnabledEventConfig, "retryBaseMs" | "retryMaxMs">
): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 30);
  const exponential = Math.min(
    config.retryMaxMs,
    config.retryBaseMs * 2 ** exponent
  );
  const jitterRange = Math.max(1, Math.floor(exponential * 0.2));
  const data = safeMessageData(message) ?? new Uint8Array();
  const jitterSeed = createHash("sha256")
    .update("realtime-session-family-revocation-retry-v1\0")
    .update(data)
    .update(String(attempt))
    .digest()
    .readUInt32BE(0);
  const jitter =
    (jitterSeed % (jitterRange * 2 + 1)) - jitterRange;
  return Math.max(
    1,
    Math.min(config.retryMaxMs, exponential + jitter)
  );
}

function safeNak(message: JsMsg, delayMs: number): void {
  try {
    message.nak(delayMs);
  } catch {
    // Leaving the source unacknowledged preserves server-side redelivery.
  }
}

async function acknowledgeSource(
  message: JsMsg,
  timeoutMs: number
): Promise<void> {
  const acknowledged = await message.ackAck({ timeout: timeoutMs });
  if (!acknowledged) {
    throw new Error("JetStream did not confirm the source acknowledgement");
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
