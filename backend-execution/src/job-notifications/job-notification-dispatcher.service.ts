import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
import {
  terminalJobNotificationStatuses,
  type InternalDeliverJobNotificationInput,
  type TerminalJobNotificationStatus
} from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import {
  Prisma,
  type Job,
  type OutboxEvent
} from "../generated/prisma/client.js";
import {
  JobNotificationClient,
  JobNotificationDeliveryError
} from "../platform-api/job-notification.client.js";

const POLL_INTERVAL_MS = 2_000;
const CLAIM_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 8;
const MAX_PROGRESS = 20_000_000;
const TERMINAL_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1_000;
const OUTBOX_EVENT_TYPES: Readonly<Record<TerminalJobNotificationStatus, string>> = {
  COMPLETED: "job.notification.completed.requested.v1",
  PARTIALLY_COMPLETED: "job.notification.partially-completed.requested.v1",
  CANCELLED: "job.notification.cancelled.requested.v1",
  FAILED_FINAL: "job.notification.failed.requested.v1",
  ACTION_REQUIRED: "job.notification.action-required.requested.v1"
};
const EVENT_TYPE_SET = Object.values(OUTBOX_EVENT_TYPES);

@Injectable()
export class JobNotificationDispatcherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(JobNotificationDispatcherService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopping = false;

  public constructor(
    private readonly prisma: PrismaService,
    private readonly client: JobNotificationClient
  ) {}

  public onModuleInit(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  public async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  public async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      await this.enqueueTerminalJobs();
      await this.dispatchPending();
    } catch {
      // Database errors may contain query parameters; keep tenant data out of logs.
      this.logger.error("Job notification reconciliation failed");
    } finally {
      this.running = false;
    }
  }

  public async enqueueTerminalJobs(limit = 200): Promise<number> {
    const batchSize = Number.isSafeInteger(limit)
      ? Math.min(Math.max(limit, 1), 500)
      : 200;
    // Exclude already enqueued states BEFORE the limit. Otherwise the latest
    // 200 jobs starve the rest forever and cause a duplicate INSERT every tick.
    const eventTypes = Prisma.join(Object.entries(OUTBOX_EVENT_TYPES).map(
      ([status, eventType]) => Prisma.sql`WHEN ${status} THEN ${eventType}`
    ), " ");
    const jobs = await this.prisma.$queryRaw<Pick<Job,
      "id" | "workspaceId" | "projectId" | "actorId" | "type" | "status" |
      "progressCurrent" | "progressTotal" | "errorSummary"
    >[]>(Prisma.sql`
      SELECT j.id, j.workspace_id AS "workspaceId", j.project_id AS "projectId",
        j.actor_id AS "actorId", j.type, j.status,
        j.progress_current AS "progressCurrent", j.progress_total AS "progressTotal",
        j.error_summary AS "errorSummary"
      FROM jobs j
      WHERE j.actor_id IS NOT NULL AND j.project_id IS NOT NULL
        AND j.type <> 'TECHNICAL_CRAWL'
        AND j.status::text IN (${Prisma.join(terminalJobNotificationStatuses)})
        AND j.updated_at >= ${new Date(Date.now() - TERMINAL_LOOKBACK_MS)}
        AND NOT EXISTS (
          SELECT 1 FROM outbox_events e
          WHERE e.aggregate_id = j.id
            AND e.event_type = CASE j.status::text ${eventTypes} END
        )
      ORDER BY j.updated_at ASC, j.id ASC
      LIMIT ${batchSize}
    `);
    const events: Prisma.OutboxEventCreateManyInput[] = [];
    for (const job of jobs) {
      if (!job.projectId || !job.actorId || !isTerminal(job.status)) continue;
      const eventType = OUTBOX_EVENT_TYPES[job.status];
      if (!eventType) continue;
      events.push({
        eventType,
        aggregateId: job.id,
        workspaceId: job.workspaceId,
        projectId: job.projectId,
        payload: {
          workspaceId: job.workspaceId,
          projectId: job.projectId,
          actorId: job.actorId,
          jobId: job.id,
          jobType: job.type,
          status: job.status,
          progressCurrent: progressNumber(job.progressCurrent),
          progressTotal: job.progressTotal === null
            ? null
            : progressNumber(job.progressTotal),
          errorCode: errorCode(job.errorSummary),
          idempotencyKey: `job-notification:${job.id}:${job.status}`
        },
        metadata: { schemaVersion: 1 }
      });
    }
    if (events.length === 0) return 0;
    // The partial unique index remains the final arbiter between replicas.
    // ON CONFLICT avoids exceptions and PostgreSQL ERROR/STATEMENT log floods.
    const result = await this.prisma.outboxEvent.createMany({
      data: events,
      skipDuplicates: true
    });
    return result.count;
  }

  public async dispatchPending(limit = 50): Promise<number> {
    let processed = 0;
    while (processed < Math.min(Math.max(limit, 1), 100)) {
      const event = await this.claim();
      if (!event) break;
      processed += 1;
      await this.deliver(event);
    }
    return processed;
  }

  private async claim(): Promise<OutboxEvent | undefined> {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const event = await transaction.outboxEvent.findFirst({
        where: {
          eventType: { in: EVENT_TYPE_SET },
          status: "PENDING",
          availableAt: { lte: now }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      });
      if (!event) return undefined;
      const claimed = await transaction.outboxEvent.updateMany({
        where: {
          id: event.id,
          status: "PENDING",
          availableAt: { lte: now }
        },
        data: {
          attempts: { increment: 1 },
          availableAt: new Date(now.getTime() + CLAIM_TIMEOUT_MS)
        }
      });
      return claimed.count === 1
        ? { ...event, attempts: event.attempts + 1 }
        : undefined;
    });
  }

  private async deliver(event: OutboxEvent): Promise<void> {
    let input: InternalDeliverJobNotificationInput;
    try {
      input = jobNotificationPayload(event);
    } catch {
      await this.fail(event.id);
      this.logger.error("Invalid job notification outbox event");
      return;
    }
    try {
      await this.client.deliver(input);
      await this.prisma.outboxEvent.updateMany({
        where: { id: event.id, status: "PENDING" },
        data: { status: "PUBLISHED", publishedAt: new Date() }
      });
    } catch (error) {
      const retryable =
        error instanceof JobNotificationDeliveryError &&
        error.retryable &&
        event.attempts < MAX_ATTEMPTS;
      if (!retryable) {
        await this.fail(event.id);
        this.logger.warn("Job notification delivery stopped");
        return;
      }
      const delay = Math.min(2 ** event.attempts * 1_000, 60_000);
      await this.prisma.outboxEvent.updateMany({
        where: { id: event.id, status: "PENDING" },
        data: { availableAt: new Date(Date.now() + delay) }
      });
    }
  }

  private async fail(eventId: string): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: { id: eventId, status: "PENDING" },
      data: { status: "FAILED" }
    });
  }
}

export function jobNotificationPayload(
  event: Pick<OutboxEvent, "aggregateId" | "eventType" | "workspaceId" | "projectId" | "payload">
): InternalDeliverJobNotificationInput {
  const payload = exactRecord(event.payload, [
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "jobType",
    "status",
    "progressCurrent",
    "progressTotal",
    "errorCode",
    "idempotencyKey"
  ]);
  if (
    !payload ||
    payload.workspaceId !== event.workspaceId ||
    payload.projectId !== event.projectId ||
    payload.jobId !== event.aggregateId ||
    !isTerminal(String(payload.status)) ||
    event.eventType !== OUTBOX_EVENT_TYPES[String(payload.status) as TerminalJobNotificationStatus] ||
    typeof payload.actorId !== "string" ||
    typeof payload.jobType !== "string" ||
    !Number.isSafeInteger(payload.progressCurrent) ||
    !(
      payload.progressTotal === null ||
      Number.isSafeInteger(payload.progressTotal)
    ) ||
    !(payload.errorCode === null || typeof payload.errorCode === "string") ||
    payload.idempotencyKey !==
      `job-notification:${event.aggregateId}:${String(payload.status)}`
  ) {
    throw new TypeError("Invalid job notification outbox payload");
  }
  return payload as unknown as InternalDeliverJobNotificationInput;
}

function exactRecord(
  value: Prisma.JsonValue,
  fields: readonly string[]
): Readonly<Record<string, Prisma.JsonValue>> | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((field) => !fields.includes(field))
  ) {
    return undefined;
  }
  return value as Readonly<Record<string, Prisma.JsonValue>>;
}

function progressNumber(value: bigint): number {
  if (value < 0n || value > BigInt(MAX_PROGRESS)) {
    throw new RangeError("Job notification progress is outside its contract");
  }
  return Number(value);
}

function errorCode(value: Prisma.JsonValue | null): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return typeof value.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(value.code)
    ? value.code
    : null;
}

function isTerminal(value: string): value is TerminalJobNotificationStatus {
  return terminalJobNotificationStatuses.includes(
    value as TerminalJobNotificationStatus
  );
}
