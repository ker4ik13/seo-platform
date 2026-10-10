import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
import {
  technicalCrawlMaxUrlLimit,
  technicalCrawlMaxIssueLimit,
  type InternalDeliverCrawlNotificationInput
} from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import type { OutboxEvent, Prisma } from "../generated/prisma/client.js";
import {
  CrawlNotificationClient,
  CrawlNotificationDeliveryError
} from "../platform-api/crawl-notification.client.js";

const EVENT_TYPE = "technical-crawl.notification.requested.v1";
const POLL_INTERVAL_MS = 2_000;
const CLAIM_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 8;

@Injectable()
export class CrawlNotificationDispatcherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    CrawlNotificationDispatcherService.name
  );
  private timer?: NodeJS.Timeout;
  private dispatching = false;
  private stopping = false;

  public constructor(
    private readonly prisma: PrismaService,
    private readonly client: CrawlNotificationClient
  ) {}

  public onModuleInit(): void {
    void this.dispatch();
    this.timer = setInterval(() => void this.dispatch(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  public async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    while (this.dispatching) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  public async dispatch(limit = 20): Promise<number> {
    if (this.dispatching || this.stopping) return 0;
    this.dispatching = true;
    let processed = 0;
    try {
      while (processed < Math.min(Math.max(limit, 1), 100)) {
        const event = await this.claim();
        if (!event) break;
        processed += 1;
        await this.deliver(event);
      }
      return processed;
    } finally {
      this.dispatching = false;
    }
  }

  private async claim(): Promise<OutboxEvent | undefined> {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const event = await transaction.outboxEvent.findFirst({
        where: {
          eventType: EVENT_TYPE,
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
    let input: InternalDeliverCrawlNotificationInput;
    try {
      input = crawlNotificationPayload(event);
    } catch {
      await this.fail(event.id);
      this.logger.error("Invalid crawl notification outbox event");
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
        error instanceof CrawlNotificationDeliveryError &&
        error.retryable &&
        event.attempts < MAX_ATTEMPTS;
      if (!retryable) {
        await this.fail(event.id);
        this.logger.warn("Crawl notification delivery stopped");
        return;
      }
      const delay = Math.min(2 ** event.attempts * 1_000, 60_000);
      await this.prisma.outboxEvent.updateMany({
        where: { id: event.id, status: "PENDING" },
        data: { availableAt: new Date(Date.now() + delay) }
      });
      this.logger.warn("Crawl notification delivery will be retried");
    }
  }

  private async fail(eventId: string): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: { id: eventId, status: "PENDING" },
      data: { status: "FAILED" }
    });
  }
}

export function crawlNotificationPayload(
  event: Pick<OutboxEvent, "aggregateId" | "workspaceId" | "projectId" | "payload">
): InternalDeliverCrawlNotificationInput {
  const currentFields = [
    "workspaceId",
    "projectId",
    "actorId",
    "crawlId",
    "purpose",
    "status",
    "processedUrls",
    "issueCount",
    "idempotencyKey"
  ] as const;
  const legacyFields = currentFields.filter((field) => field !== "purpose");
  const payload = exactRecord(event.payload, currentFields) ??
    exactRecord(event.payload, legacyFields);
  if (
    !payload ||
    payload.workspaceId !== event.workspaceId ||
    payload.projectId !== event.projectId ||
    payload.crawlId !== event.aggregateId ||
    typeof payload.actorId !== "string" ||
    (payload.purpose !== undefined &&
      !["TECHNICAL_AUDIT", "HTTP_STATUS_CHECK"].includes(
        String(payload.purpose)
      )) ||
    !["COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED", "FAILED"].includes(
      String(payload.status)
    ) ||
    !nonNegativeInteger(payload.processedUrls, technicalCrawlMaxUrlLimit) ||
    !nonNegativeInteger(payload.issueCount, technicalCrawlMaxIssueLimit) ||
    payload.idempotencyKey !==
      `crawl-notification:${event.aggregateId}`
  ) {
    throw new TypeError("Invalid crawl notification outbox payload");
  }
  return {
    ...(payload as unknown as InternalDeliverCrawlNotificationInput),
    purpose: payload.purpose === "HTTP_STATUS_CHECK"
      ? "HTTP_STATUS_CHECK"
      : "TECHNICAL_AUDIT"
  };
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

function nonNegativeInteger(value: unknown, maximum: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0 &&
    Number(value) <= maximum;
}
