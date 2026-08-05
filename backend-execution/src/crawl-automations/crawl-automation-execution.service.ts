import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  CrawlAutomationRunCollection,
  CrawlAutomationRunSummary,
  InternalRunCrawlAutomationInput
} from "@seo-platform/contracts";
import type {
  CrawlAutomation,
  CrawlAutomationRun,
  Prisma,
  TechnicalCrawlStatus
} from "../generated/prisma/client.js";
import { databaseClock } from "../database/database-clock.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  CrawlAutomationDispatchClient,
  CrawlAutomationDispatchError
} from "../platform-api/crawl-automation-dispatch.client.js";
import { QueueService } from "../queue/queue.service.js";
import {
  crawlAutomationDefinitionJson,
  storedCrawlAutomationDefinition,
  toCrawlAutomationRunSummary
} from "./crawl-automation-record.js";

const SUCCESS_STATUSES = new Set<TechnicalCrawlStatus>([
  "COMPLETED",
  "PARTIALLY_COMPLETED"
]);
const TERMINAL_STATUSES = new Set<TechnicalCrawlStatus>([
  ...SUCCESS_STATUSES,
  "FAILED",
  "CANCELLED"
]);

@Injectable()
export class CrawlAutomationExecutionService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly dispatchClient: CrawlAutomationDispatchClient,
    private readonly queue: QueueService
  ) {}

  public async executeScheduled(
    automationId: string,
    automationVersion: number,
    scheduledFor: Date
  ): Promise<void> {
    await this.settleForAutomation(automationId);
    const claimed = await this.claimScheduled(
      automationId,
      automationVersion,
      scheduledFor
    );
    if (!claimed || claimed.run.status !== "RUNNING") return;
    await this.dispatch(claimed.automation, claimed.run);
  }

  public async triggerManual(
    input: InternalRunCrawlAutomationInput
  ): Promise<CrawlAutomationRunSummary> {
    await this.settleForAutomation(input.automationId);
    const claimed = await this.claimManual(input);
    if (claimed.run.status === "RUNNING") {
      await this.dispatch(claimed.automation, claimed.run);
    }
    const current = await this.prisma.crawlAutomationRun.findUnique({
      where: { id: claimed.run.id }
    });
    if (!current) throw new NotFoundException("Automation run not found");
    return toCrawlAutomationRunSummary(current);
  }

  public async listRuns(
    workspaceId: string,
    projectId: string,
    automationId: string
  ): Promise<CrawlAutomationRunCollection> {
    const automation = await this.prisma.crawlAutomation.findFirst({
      where: { id: automationId, workspaceId, projectId },
      select: { id: true }
    });
    if (!automation) return { runs: [], truncated: false };
    const runs = await this.prisma.crawlAutomationRun.findMany({
      where: { automationId, workspaceId, projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51
    });
    return {
      runs: runs.slice(0, 50).map(toCrawlAutomationRunSummary),
      truncated: runs.length > 50
    };
  }

  public async settleDispatched(limit = 100): Promise<number> {
    const runs = await this.prisma.crawlAutomationRun.findMany({
      where: { status: "DISPATCHED" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: Math.min(Math.max(limit, 1), 500)
    });
    let settled = 0;
    for (const run of runs) {
      if (await this.settleRun(run)) settled += 1;
    }
    return settled;
  }

  public async recoverRunning(
    limit = 100,
    staleAfterMs = 2 * 60 * 1_000
  ): Promise<number> {
    const now = await databaseNow(this.prisma);
    const cutoff = new Date(
      now.getTime() - Math.max(staleAfterMs, 30_000)
    );
    const candidates = await this.prisma.crawlAutomationRun.findMany({
      where: { status: "RUNNING", updatedAt: { lte: cutoff } },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: Math.min(Math.max(limit, 1), 500),
      select: { id: true }
    });
    let recovered = 0;
    for (const candidate of candidates) {
      const claimed = await this.claimRecovery(candidate.id, cutoff);
      if (!claimed) continue;
      recovered += 1;
      await this.dispatch(claimed.automation, claimed.run);
    }
    return recovered;
  }

  private async claimScheduled(
    automationId: string,
    automationVersion: number,
    scheduledFor: Date
  ): Promise<
    | {
        readonly automation: CrawlAutomation;
        readonly run: CrawlAutomationRun;
      }
    | undefined
  > {
    if (Number.isNaN(scheduledFor.getTime())) return undefined;
    return this.prisma.$transaction(async (transaction) => {
      await lockAutomation(transaction, automationId);
      const now = await databaseNow(transaction);
      if (
        Math.abs(now.getTime() - scheduledFor.getTime()) >
        31 * 24 * 60 * 60 * 1_000
      ) {
        return undefined;
      }
      const automation = await transaction.crawlAutomation.findUnique({
        where: { id: automationId }
      });
      if (
        !automation ||
        !automation.enabled ||
        automation.version !== automationVersion
      ) {
        return undefined;
      }
      const replay = await transaction.crawlAutomationRun.findUnique({
        where: {
          automationId_scheduledFor: { automationId, scheduledFor }
        }
      });
      if (replay) return { automation, run: replay };
      const definition = storedCrawlAutomationDefinition(
        automation.definition
      );
      const skipReason = await this.skipReason(
        transaction,
        automation,
        definition.config.startUrls[0]!,
        !withinAllowedWindow(
          scheduledFor,
          automation.timezone,
          definition.allowedWindow.startMinute,
          definition.allowedWindow.endMinute
        )
      );
      const run = await transaction.crawlAutomationRun.create({
        data: {
          automationId,
          automationVersion,
          workspaceId: automation.workspaceId,
          projectId: automation.projectId,
          status: skipReason ? "SKIPPED" : "RUNNING",
          trigger: "SCHEDULE",
          scheduledFor,
          createdAt: now,
          actorId: definition.actorId,
          definition: crawlAutomationDefinitionJson(definition),
          ...(skipReason
            ? { errorCode: skipReason, finishedAt: now }
            : { startedAt: now })
        }
      });
      return { automation, run };
    });
  }

  private async claimManual(
    input: InternalRunCrawlAutomationInput
  ): Promise<{
    readonly automation: CrawlAutomation;
    readonly run: CrawlAutomationRun;
  }> {
    return this.prisma.$transaction(async (transaction) => {
      await lockAutomation(transaction, input.automationId);
      const automation = await transaction.crawlAutomation.findFirst({
        where: {
          id: input.automationId,
          workspaceId: input.workspaceId,
          projectId: input.projectId
        }
      });
      if (!automation) throw new NotFoundException("Automation not found");
      const replay = await transaction.crawlAutomationRun.findUnique({
        where: {
          automationId_actorId_idempotencyKey: {
            automationId: input.automationId,
            actorId: input.actorId,
            idempotencyKey: input.idempotencyKey
          }
        }
      });
      if (replay) return { automation, run: replay };
      assertVersion(automation, input.expectedVersion);
      const now = await databaseNow(transaction);
      const definition = {
        ...storedCrawlAutomationDefinition(automation.definition),
        actorId: input.actorId
      };
      const skipReason = await this.skipReason(
        transaction,
        automation,
        definition.config.startUrls[0]!,
        false
      );
      const run = await transaction.crawlAutomationRun.create({
        data: {
          automationId: automation.id,
          automationVersion: automation.version,
          workspaceId: automation.workspaceId,
          projectId: automation.projectId,
          status: skipReason ? "SKIPPED" : "RUNNING",
          trigger: "MANUAL",
          scheduledFor: now,
          createdAt: now,
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey,
          definition: crawlAutomationDefinitionJson(definition),
          ...(skipReason
            ? { errorCode: skipReason, finishedAt: now }
            : { startedAt: now })
        }
      });
      return { automation, run };
    });
  }

  private async skipReason(
    transaction: Prisma.TransactionClient,
    automation: CrawlAutomation,
    startUrl: string,
    outsideWindow: boolean
  ): Promise<string | undefined> {
    if (outsideWindow) return "OUTSIDE_ALLOWED_WINDOW";
    const activeRun = await transaction.crawlAutomationRun.findFirst({
      where: {
        automationId: automation.id,
        status: { in: ["RUNNING", "DISPATCHED"] }
      },
      select: { id: true }
    });
    if (activeRun) return "OVERLAPPING_RUN";
    const host = new URL(startUrl).hostname.toLowerCase();
    const activeCrawl = await transaction.technicalCrawl.findFirst({
      where: {
        host,
        status: { in: ["QUEUED", "RUNNING", "CANCEL_REQUESTED"] }
      },
      select: { id: true }
    });
    if (activeCrawl) return "HOST_CRAWL_ACTIVE";
    const hostState = await transaction.crawlHostState.findUnique({
      where: { host },
      select: { backoffUntil: true }
    });
    if (
      hostState?.backoffUntil &&
      hostState.backoffUntil > (await databaseNow(transaction))
    ) {
      return "HOST_BACKOFF";
    }
    return undefined;
  }

  private async dispatch(
    automation: CrawlAutomation,
    run: CrawlAutomationRun
  ): Promise<void> {
    try {
      const definition = storedCrawlAutomationDefinition(run.definition);
      const receipt = await this.dispatchClient.dispatch({
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        actorId: run.actorId,
        automationId: run.automationId,
        automationVersion: run.automationVersion,
        runId: run.id,
        idempotencyKey: `crawl-automation-${run.id}`,
        scheduledFor: run.scheduledFor.toISOString(),
        config: definition.config
      });
      await this.prisma.$transaction(async (transaction) => {
        await lockAutomation(transaction, automation.id);
        await transaction.crawlAutomationRun.updateMany({
          where: { id: run.id, status: "RUNNING" },
          data: {
            status: "DISPATCHED",
            crawlId: receipt.crawl.id,
            jobId: receipt.crawl.jobId
          }
        });
        await transaction.crawlAutomation.updateMany({
          where: { id: automation.id },
          data: { lastRunAt: run.scheduledFor }
        });
      });
    } catch (error) {
      await this.fail(automation, run, safeError(error));
    }
  }

  private async settleForAutomation(automationId: string): Promise<void> {
    const runs = await this.prisma.crawlAutomationRun.findMany({
      where: { automationId, status: "DISPATCHED" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 10
    });
    for (const run of runs) await this.settleRun(run);
  }

  private async settleRun(run: CrawlAutomationRun): Promise<boolean> {
    if (!run.crawlId) return false;
    const crawl = await this.prisma.technicalCrawl.findFirst({
      where: {
        id: run.crawlId,
        workspaceId: run.workspaceId,
        projectId: run.projectId
      },
      select: { status: true, failureCode: true }
    });
    if (!crawl || !TERMINAL_STATUSES.has(crawl.status)) return false;
    const automation = await this.prisma.crawlAutomation.findUnique({
      where: { id: run.automationId }
    });
    if (!automation) return false;
    if (SUCCESS_STATUSES.has(crawl.status)) {
      await this.prisma.$transaction(async (transaction) => {
        await lockAutomation(transaction, automation.id);
        const now = await databaseNow(transaction);
        const changed = await transaction.crawlAutomationRun.updateMany({
          where: { id: run.id, status: "DISPATCHED" },
          data: { status: "COMPLETED", finishedAt: now }
        });
        if (changed.count === 1) {
          await transaction.crawlAutomation.update({
            where: { id: automation.id },
            data: { consecutiveErr: 0 }
          });
        }
      });
      return true;
    }
    await this.fail(
      automation,
      run,
      crawl.failureCode ?? `CRAWL_${crawl.status}`
    );
    return true;
  }

  private async fail(
    automation: CrawlAutomation,
    run: CrawlAutomationRun,
    errorCode: string
  ): Promise<void> {
    const paused = await this.prisma.$transaction(async (transaction) => {
      await lockAutomation(transaction, automation.id);
      const current = await transaction.crawlAutomation.findUnique({
        where: { id: automation.id }
      });
      if (!current) return false;
      const now = await databaseNow(transaction);
      const changed = await transaction.crawlAutomationRun.updateMany({
        where: {
          id: run.id,
          automationId: automation.id,
          status: { in: ["RUNNING", "DISPATCHED"] }
        },
        data: {
          status: "FAILED",
          errorCode: boundedErrorCode(errorCode),
          finishedAt: now
        }
      });
      if (changed.count === 0) return !current.enabled;
      const definition = storedCrawlAutomationDefinition(run.definition);
      const consecutiveErrors = current.consecutiveErr + 1;
      const hardPause =
        errorCode === "AUTHORIZATION_REVOKED" ||
        errorCode === "READ_ONLY_BILLING";
      const autoPause =
        hardPause || consecutiveErrors >= definition.failureThreshold;
      await transaction.crawlAutomation.update({
        where: { id: current.id },
        data: {
          consecutiveErr: consecutiveErrors,
          ...(autoPause
            ? {
                enabled: false,
                pausedReason: hardPause
                  ? errorCode
                  : "FAILURE_THRESHOLD",
                nextRunAt: null,
                version: { increment: 1 }
              }
            : {})
        }
      });
      return autoPause;
    });
    if (paused) {
      await this.queue
        .removeCrawlAutomationScheduler(automation.id)
        .catch(() => undefined);
    }
  }

  private async claimRecovery(
    runId: string,
    cutoff: Date
  ): Promise<
    | {
        readonly automation: CrawlAutomation;
        readonly run: CrawlAutomationRun;
      }
    | undefined
  > {
    return this.prisma.$transaction(async (transaction) => {
      const candidate = await transaction.crawlAutomationRun.findUnique({
        where: { id: runId }
      });
      if (
        !candidate ||
        candidate.status !== "RUNNING" ||
        candidate.updatedAt > cutoff
      ) {
        return undefined;
      }
      await lockAutomation(transaction, candidate.automationId);
      const automation = await transaction.crawlAutomation.findUnique({
        where: { id: candidate.automationId }
      });
      const run = await transaction.crawlAutomationRun.findUnique({
        where: { id: candidate.id }
      });
      if (!automation || !run || run.status !== "RUNNING") {
        return undefined;
      }
      return { automation, run };
    });
  }
}

export function withinAllowedWindow(
  date: Date,
  timezone: string,
  startMinute: number,
  endMinute: number
): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const hour = Number(parts.find(({ type }) => type === "hour")?.value);
  const minute = Number(
    parts.find(({ type }) => type === "minute")?.value
  );
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error("Unable to resolve crawl automation local time");
  }
  const localMinute = hour * 60 + minute;
  return localMinute >= startMinute && localMinute < endMinute;
}

async function lockAutomation(
  transaction: Prisma.TransactionClient,
  automationId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`crawl-automation:${automationId}`}, 0)
    )
  `;
}

async function databaseNow(
  transaction: Pick<Prisma.TransactionClient, "$queryRaw">
): Promise<Date> {
  return databaseClock(
    transaction,
    "Unable to read automation database clock"
  );
}

function assertVersion(
  automation: CrawlAutomation,
  expectedVersion: number
): void {
  if (automation.version === expectedVersion) return;
  throw new HttpException(
    {
      error: {
        code: "VERSION_CONFLICT",
        message: "Crawl automation version conflict",
        details: { currentVersion: automation.version }
      }
    },
    HttpStatus.PRECONDITION_FAILED
  );
}

function safeError(error: unknown): string {
  if (error instanceof CrawlAutomationDispatchError) return error.code;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return boundedErrorCode(error.code);
  }
  return "DEPENDENCY_UNAVAILABLE";
}

function boundedErrorCode(value: string): string {
  return /^[A-Z][A-Z0-9_]{0,99}$/u.test(value)
    ? value
    : "DEPENDENCY_UNAVAILABLE";
}
