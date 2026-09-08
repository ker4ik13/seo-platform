import { createHash } from "node:crypto";
import {
  Inject,
  Injectable,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap
} from "@nestjs/common";
import {
  createSessionFamilyRevokedEventEnvelopeV1,
  InvalidSessionFamilyRevokedEventEnvelopeError,
  sessionFamilyRevokedEventAggregateTypeV1,
  sessionFamilyRevokedEventAggregateVersionV1,
  sessionFamilyRevokedEventProducerV1,
  sessionFamilyRevokedEventSubjectV1,
  sessionFamilyRevokedEventTypeV1,
  transactionalEmailEventSubjectV1,
  transactionalEmailEventTypesV1,
  type TransactionalEmailEventEnvelopeV1,
  type SessionFamilyRevokedEventEnvelopeV1
} from "@seo-platform/contracts";
import {
  transactionalEmailEnvelopeFromOutbox,
  type AuthEmailOutboxRow
} from "../auth-email/auth-email-outbox.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { NatsService } from "../messaging/nats.service.js";

export const OUTBOX_PUBLISHER_SCHEDULER = Symbol(
  "OUTBOX_PUBLISHER_SCHEDULER"
);
export const OUTBOX_PUBLISHER_LOGGER = Symbol("OUTBOX_PUBLISHER_LOGGER");

export interface OutboxPublisherScheduler {
  schedule(task: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface OutboxPublisherLogger {
  warn(message: string): void;
}

interface ClaimedOutboxEvent extends AuthEmailOutboxRow {}

type PublishOneOutcome = "EMPTY" | "PROCESSED" | "FAILED_FINAL";

@Injectable()
export class OutboxPublisherService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private scheduledHandle: unknown;
  private activeRun: Promise<number> | undefined;
  private stopping = false;

  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly nats: NatsService,
    @Inject(OUTBOX_PUBLISHER_SCHEDULER)
    private readonly scheduler: OutboxPublisherScheduler,
    @Inject(OUTBOX_PUBLISHER_LOGGER)
    private readonly logger: OutboxPublisherLogger
  ) {}

  public onApplicationBootstrap(): void {
    if (!this.config.outboxPublisher.enabled) return;
    this.stopping = false;
    this.scheduleNext(0);
  }

  // This phase finishes the bounded PubAck/DB transition before the NATS and
  // Prisma adapters close in their later OnApplicationShutdown phase.
  public async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.scheduledHandle !== undefined) {
      this.scheduler.cancel(this.scheduledHandle);
      this.scheduledHandle = undefined;
    }
    await this.activeRun;
  }

  public runOnce(): Promise<number> {
    if (!this.config.outboxPublisher.enabled || this.stopping) {
      return Promise.resolve(0);
    }
    if (this.activeRun) return this.activeRun;

    const run = this.publishBatch();
    this.activeRun = run;
    const clearActiveRun = (): void => {
      if (this.activeRun === run) this.activeRun = undefined;
    };
    void run.then(clearActiveRun, clearActiveRun);
    return run;
  }

  private async publishBatch(): Promise<number> {
    let processed = 0;
    while (
      processed < this.config.outboxPublisher.batchSize &&
      !this.stopping
    ) {
      const claimed = await this.publishOne();
      if (!claimed) break;
      processed += 1;
    }
    return processed;
  }

  private async publishOne(): Promise<boolean> {
    const eventEnvironment = this.config.outboxPublisher.eventEnvironment;
    if (!eventEnvironment) {
      throw new Error("Outbox publisher configuration is incomplete");
    }

    const outcome: PublishOneOutcome = await this.prisma.$transaction(
      async (transaction) => {
        const rows = await transaction.$queryRaw<ClaimedOutboxEvent[]>`
          SELECT
            id,
            event_type,
            aggregate_type,
            aggregate_id,
            aggregate_version,
            workspace_id,
            project_id,
            payload,
            metadata,
            attempts,
            created_at
          FROM outbox_events
          WHERE status = 'PENDING'::"OutboxStatus"
            AND available_at <= CURRENT_TIMESTAMP
            AND event_type IN (
              ${sessionFamilyRevokedEventTypeV1},
              ${transactionalEmailEventTypesV1.emailVerificationRequested},
              ${transactionalEmailEventTypesV1.passwordResetRequested},
              ${transactionalEmailEventTypesV1.workspaceInviteRequested},
              ${transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested},
              ${transactionalEmailEventTypesV1.billingNoticeRequested}
            )
          ORDER BY available_at ASC, created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `;
        const row = rows[0];
        if (!row) return "EMPTY" as const;

        try {
          const publication = publicationFromOutbox(
            row,
            eventEnvironment,
            this.config
          );
          const acknowledgement = await this.nats.publishOutboxEvent(
            publication.subject,
            JSON.stringify(publication.envelope),
            row.id,
            publication.streamName
          );
          if (
            acknowledgement.stream !== publication.streamName ||
            !Number.isSafeInteger(acknowledgement.seq) ||
            acknowledgement.seq <= 0
          ) {
            throw new Error("JetStream returned an invalid outbox PubAck");
          }

          const updated = await transaction.$executeRaw`
            UPDATE outbox_events
            SET
              status = 'PUBLISHED'::"OutboxStatus",
              published_at = CURRENT_TIMESTAMP
            WHERE id = ${row.id}::uuid
              AND status = 'PENDING'::"OutboxStatus"
          `;
          if (updated !== 1) {
            throw new Error("Outbox publish transition was not applied");
          }
        } catch {
          const failedFinal = await this.recordFailure(transaction, row);
          return failedFinal ? "FAILED_FINAL" : "PROCESSED";
        }

        return "PROCESSED" as const;
      },
      {
        maxWait: 5_000,
        timeout: this.config.outboxPublisher.publishTimeoutMs + 5_000
      }
    );
    if (outcome === "FAILED_FINAL") {
      // Fixed code only: transport/provider errors can contain credentials.
      // Operations can aggregate this warning as the terminal-failure metric.
      this.logger.warn("OUTBOX_PUBLISHER_EVENT_FAILED_FINAL");
    }
    return outcome !== "EMPTY";
  }

  private async recordFailure(
    transaction: Prisma.TransactionClient,
    row: ClaimedOutboxEvent
  ): Promise<boolean> {
    const attempts = row.attempts + 1;
    if (attempts >= this.config.outboxPublisher.maxAttempts) {
      const updated = await transaction.$executeRaw`
        UPDATE outbox_events
        SET
          status = 'FAILED'::"OutboxStatus",
          attempts = ${attempts},
          available_at = CURRENT_TIMESTAMP,
          published_at = NULL
        WHERE id = ${row.id}::uuid
          AND status = 'PENDING'::"OutboxStatus"
      `;
      if (updated !== 1) {
        throw new Error("Outbox terminal failure transition was not applied");
      }
      return true;
    }

    const retryDelayMs = boundedRetryDelayMs(
      row.id,
      attempts,
      this.config.outboxPublisher.retryBaseMs,
      this.config.outboxPublisher.retryMaxMs
    );
    const updated = await transaction.$executeRaw`
      UPDATE outbox_events
      SET
        attempts = ${attempts},
        available_at = CURRENT_TIMESTAMP +
          (${retryDelayMs}::double precision * INTERVAL '1 millisecond'),
        published_at = NULL
      WHERE id = ${row.id}::uuid
        AND status = 'PENDING'::"OutboxStatus"
    `;
    if (updated !== 1) {
      throw new Error("Outbox retry transition was not applied");
    }
    return false;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopping) return;
    this.scheduledHandle = this.scheduler.schedule(() => {
      this.scheduledHandle = undefined;
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (this.stopping) return;
    try {
      await this.runOnce();
    } catch {
      this.logger.warn("OUTBOX_PUBLISHER_TICK_FAILED");
    } finally {
      if (!this.stopping) {
        this.scheduleNext(this.config.outboxPublisher.pollIntervalMs);
      }
    }
  }
}

interface OutboxPublication {
  readonly subject: string;
  readonly streamName: string;
  readonly envelope:
    | SessionFamilyRevokedEventEnvelopeV1
    | TransactionalEmailEventEnvelopeV1;
}

function publicationFromOutbox(
  row: ClaimedOutboxEvent,
  eventEnvironment: string,
  config: AppConfig
): OutboxPublication {
  if (row.event_type === sessionFamilyRevokedEventTypeV1) {
    const streamName = config.outboxPublisher.streamName;
    if (!streamName) {
      throw new Error("Identity outbox stream is not configured");
    }
    return {
      streamName,
      subject: sessionFamilyRevokedEventSubjectV1(eventEnvironment),
      envelope: envelopeFromOutbox(row)
    };
  }

  const streamName = config.outboxPublisher.authEmailStreamName;
  if (!streamName) {
    throw new Error("Auth-email outbox stream is not configured");
  }
  const envelope = transactionalEmailEnvelopeFromOutbox(row);
  return {
    streamName,
    subject: transactionalEmailEventSubjectV1(
      eventEnvironment,
      envelope.eventType
    ),
    envelope
  };
}

function envelopeFromOutbox(
  row: ClaimedOutboxEvent
): SessionFamilyRevokedEventEnvelopeV1 {
  const payload = plainRecord(row.payload);
  const metadata = plainRecord(row.metadata);
  const userId = stringValue(payload.userId);
  const sessionFamilyId = stringValue(payload.sessionFamilyId);
  const revokedAt = dateValue(payload.revokedAt);

  if (
    row.event_type !== sessionFamilyRevokedEventTypeV1 ||
    row.aggregate_type !== sessionFamilyRevokedEventAggregateTypeV1 ||
    row.aggregate_id !== sessionFamilyId ||
    row.aggregate_version !== sessionFamilyRevokedEventAggregateVersionV1 ||
    row.workspace_id !== null ||
    row.project_id !== null ||
    metadata.producer !== sessionFamilyRevokedEventProducerV1 ||
    !(row.created_at instanceof Date)
  ) {
    throw new InvalidSessionFamilyRevokedEventEnvelopeError("outbox");
  }

  const fallbackTraceId = `outbox-${row.id}`;
  const common = {
    eventId: row.id,
    occurredAt: row.created_at,
    userId,
    sessionFamilyId,
    revokedAt
  } as const;
  const requestId =
    typeof metadata.requestId === "string" ? metadata.requestId : undefined;

  if (requestId) {
    try {
      return createSessionFamilyRevokedEventEnvelopeV1({
        ...common,
        traceId: requestId,
        metadata: { correlationId: requestId }
      });
    } catch (error) {
      if (!(error instanceof InvalidSessionFamilyRevokedEventEnvelopeError)) {
        throw error;
      }
    }
  }

  return createSessionFamilyRevokedEventEnvelopeV1({
    ...common,
    traceId: fallbackTraceId,
    metadata: {}
  });
}

function plainRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new InvalidSessionFamilyRevokedEventEnvelopeError("outbox");
  }
  return value as Readonly<Record<string, unknown>>;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  throw new InvalidSessionFamilyRevokedEventEnvelopeError("outbox");
}

function dateValue(value: unknown): Date {
  if (typeof value !== "string") {
    throw new InvalidSessionFamilyRevokedEventEnvelopeError("outbox");
  }
  return new Date(value);
}

export function boundedRetryDelayMs(
  eventId: string,
  failedAttempt: number,
  baseMs: number,
  maximumMs: number
): number {
  const exponent = Math.min(30, Math.max(0, failedAttempt - 1));
  const exponential = Math.min(maximumMs, baseMs * 2 ** exponent);
  const minimum = Math.floor(exponential * 0.75);
  const width = exponential - minimum;
  const random = createHash("sha256")
    .update(`${eventId}:${failedAttempt}`)
    .digest()
    .readUInt32BE(0);
  return minimum + (random % (width + 1));
}
