import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type {
  AutomationRunCollection,
  AutomationRunSummary,
  InternalCreateRankEstimateInput,
  InternalCreateRankRunInput,
  InternalRunRankTrackingAutomationInput,
  RankEstimate
} from "@seo-platform/contracts";
import type {
  Automation,
  AutomationRun,
  JobStatus,
  Prisma
} from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { QueueService } from "../queue/queue.service.js";
import { RankEstimateService } from "../rank-estimates/rank-estimate.service.js";
import { RankRunService } from "../rank-runs/rank-run.service.js";
import {
  automationDefinitionJson,
  automationRunDefinition,
  storedAutomationDefinition
} from "./automation-record.js";

const SUCCESS_JOB_STATUSES = new Set<JobStatus>([
  "COMPLETED",
  "PARTIALLY_COMPLETED"
]);
const TERMINAL_JOB_STATUSES = new Set<JobStatus>([
  ...SUCCESS_JOB_STATUSES,
  "FAILED_FINAL",
  "CANCELLED",
  "ACTION_REQUIRED",
  "EXPIRED"
]);

@Injectable()
export class AutomationExecutionService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly estimates: RankEstimateService,
    private readonly rankRuns: RankRunService,
    private readonly queue: QueueService
  ) {}

  public async executeScheduled(
    automationId: string,
    automationVersion: number,
    scheduledFor: Date
  ): Promise<void> {
    await this.settleForAutomation(automationId);
    const claimed = await this.claim(
      automationId,
      automationVersion,
      scheduledFor
    );
    if (!claimed || claimed.run.status !== "RUNNING") return;
    await this.dispatch(claimed.automation, claimed.run);
  }

  public async triggerManual(
    input: InternalRunRankTrackingAutomationInput
  ): Promise<AutomationRunSummary> {
    await this.settleForAutomation(input.automationId);
    const claimed = await this.claimManual(input);
    if (claimed.run.status === "RUNNING") {
      await this.dispatch(claimed.automation, claimed.run);
    }
    const current = await this.prisma.automationRun.findUnique({
      where: { id: claimed.run.id }
    });
    if (!current) {
      throw new NotFoundException("Automation run not found");
    }
    return toAutomationRunSummary(current);
  }

  private async dispatch(
    automation: Automation,
    run: AutomationRun
  ): Promise<void> {
    let estimate: RankEstimate | undefined;
    try {
      const definition = storedAutomationDefinition(run.definition);
      const estimateInput: InternalCreateRankEstimateInput = {
        trackingContextId: definition.trackingContextId,
        workspaceId: automation.workspaceId,
        projectId: automation.projectId,
        actorId: definition.execution.actorId,
        project: definition.execution.project,
        access: {
          workspaceStatus:
            definition.execution.access.workspaceStatus,
          canRunRanking:
            definition.execution.access.canRunRanking,
          entitlementStatus:
            definition.execution.access.entitlementStatus
        },
        billingCurrency: definition.execution.billingCurrency,
        quota: { status: "NOT_AVAILABLE" }
      };
      estimate = await this.estimates.create(
        estimateInput,
        `automation-estimate-${run.id}`
      );
      if (estimate.status !== "READY" || !estimate.executionAllowed) {
        await this.fail(
          automation,
          run,
          estimate.blockers[0]?.code ?? "ESTIMATE_BLOCKED",
          estimate.id
        );
        return;
      }
      if (Number(estimate.scope.keywordCount) > definition.maxItems) {
        await this.fail(
          automation,
          run,
          "MAX_ITEMS_EXCEEDED",
          estimate.id
        );
        return;
      }

      const runInput: InternalCreateRankRunInput = {
        estimateId: estimate.id,
        workspaceId: automation.workspaceId,
        projectId: automation.projectId,
        actorId: definition.execution.actorId,
        project: definition.execution.project,
        access: {
          workspaceStatus:
            definition.execution.access.workspaceStatus,
          membershipId:
            definition.execution.access.membershipId,
          membershipVersion:
            definition.execution.access.membershipVersion,
          canRunRanking:
            definition.execution.access.canRunRanking,
          entitlementStatus:
            definition.execution.access.entitlementStatus,
          quota: { status: "NOT_AVAILABLE" }
        },
        billingCurrency: definition.execution.billingCurrency
      };
      const job = await this.rankRuns.create(
        runInput,
        `automation-rank-${run.id}`,
        `automation-${run.id}`
      );
      await this.prisma.$transaction(async (transaction) => {
        await lockAutomation(transaction, automation.id);
        await transaction.automationRun.updateMany({
          where: {
            id: run.id,
            automationId: automation.id,
            status: "RUNNING"
          },
          data: {
            status: "DISPATCHED",
            estimateId: estimate!.id,
            jobId: job.id
          }
        });
        await transaction.automation.updateMany({
          where: {
            id: automation.id
          },
          data: { lastRunAt: run.scheduledFor }
        });
      });
    } catch (error) {
      await this.fail(
        automation,
        run,
        safeAutomationError(error),
        estimate?.id
      );
    }
  }

  public async settleDispatched(limit = 100): Promise<number> {
    const runs = await this.prisma.automationRun.findMany({
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
    const candidates = await this.prisma.automationRun.findMany({
      where: {
        status: "RUNNING",
        updatedAt: { lte: cutoff }
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: Math.min(Math.max(limit, 1), 500),
      select: { id: true }
    });
    let recovered = 0;
    for (const candidate of candidates) {
      const claimed = await this.claimRunningRecovery(
        candidate.id,
        cutoff
      );
      if (!claimed) continue;
      recovered += 1;
      await this.dispatch(claimed.automation, claimed.run);
    }
    return recovered;
  }

  public async listRuns(
    workspaceId: string,
    projectId: string,
    automationId: string
  ): Promise<AutomationRunCollection> {
    const automation = await this.prisma.automation.findFirst({
      where: { id: automationId, workspaceId, projectId },
      select: { id: true }
    });
    if (!automation) {
      return { runs: [], truncated: false };
    }
    const runs = await this.prisma.automationRun.findMany({
      where: { automationId, workspaceId, projectId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51
    });
    return {
      runs: runs.slice(0, 50).map(toAutomationRunSummary),
      truncated: runs.length > 50
    };
  }

  private async claim(
    automationId: string,
    automationVersion: number,
    scheduledFor: Date
  ): Promise<
    | {
        readonly automation: Automation;
        readonly run: AutomationRun;
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
      const automation = await transaction.automation.findUnique({
        where: { id: automationId }
      });
      if (
        !automation ||
        !automation.enabled ||
        automation.version !== automationVersion
      ) {
        return undefined;
      }
      const replay = await transaction.automationRun.findUnique({
        where: {
          automationId_scheduledFor: {
            automationId,
            scheduledFor
          }
        }
      });
      if (replay) return { automation, run: replay };

      const active = await transaction.automationRun.findFirst({
        where: {
          automationId,
          status: { in: ["RUNNING", "DISPATCHED"] }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      const definition = storedAutomationDefinition(
        automation.definition
      );
      const definitionJson = automationDefinitionJson(definition);
      if (active) {
        const skipped = await transaction.automationRun.create({
          data: {
            automationId,
            automationVersion,
            workspaceId: automation.workspaceId,
            projectId: automation.projectId,
            status: "SKIPPED",
            trigger: "SCHEDULE",
            scheduledFor,
            actorId: definition.execution.actorId,
            definition: definitionJson,
            errorCode: "OVERLAPPING_RUN",
            finishedAt: now
          }
        });
        return { automation, run: skipped };
      }
      const run = await transaction.automationRun.create({
        data: {
          automationId,
          automationVersion,
          workspaceId: automation.workspaceId,
          projectId: automation.projectId,
          status: "RUNNING",
          trigger: "SCHEDULE",
          scheduledFor,
          actorId: definition.execution.actorId,
          definition: definitionJson,
          startedAt: now
        }
      });
      return { automation, run };
    });
  }

  private async claimRunningRecovery(
    runId: string,
    cutoff: Date
  ): Promise<
    | {
        readonly automation: Automation;
        readonly run: AutomationRun;
      }
    | undefined
  > {
    return this.prisma.$transaction(async (transaction) => {
      const candidate = await transaction.automationRun.findUnique({
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
      const changed = await transaction.automationRun.updateMany({
        where: {
          id: candidate.id,
          status: "RUNNING",
          updatedAt: { lte: cutoff }
        },
        data: { errorCode: null }
      });
      if (changed.count !== 1) return undefined;
      const automation = await transaction.automation.findUnique({
        where: { id: candidate.automationId }
      });
      const run = await transaction.automationRun.findUnique({
        where: { id: candidate.id }
      });
      if (!automation || !run) return undefined;
      return { automation, run };
    });
  }

  private async claimManual(
    input: InternalRunRankTrackingAutomationInput
  ): Promise<{
    readonly automation: Automation;
    readonly run: AutomationRun;
  }> {
    return this.prisma.$transaction(async (transaction) => {
      await lockAutomation(transaction, input.automationId);
      const automation = await transaction.automation.findFirst({
        where: {
          id: input.automationId,
          workspaceId: input.workspaceId,
          projectId: input.projectId
        }
      });
      if (!automation) {
        throw new NotFoundException("Automation not found");
      }
      const replay = await transaction.automationRun.findUnique({
        where: {
          automationId_actorId_idempotencyKey: {
            automationId: input.automationId,
            actorId: input.actorId,
            idempotencyKey: input.idempotencyKey
          }
        }
      });
      if (replay) return { automation, run: replay };
      if (automation.version !== input.expectedVersion) {
        throw new HttpException(
          {
            error: {
              code: "VERSION_CONFLICT",
              message: "Automation version conflict",
              details: { currentVersion: automation.version }
            }
          },
          HttpStatus.PRECONDITION_FAILED
        );
      }
      const now = await databaseNow(transaction);
      const definition = automationRunDefinition(
        automation.definition,
        input
      );
      const active = await transaction.automationRun.findFirst({
        where: {
          automationId: automation.id,
          status: { in: ["RUNNING", "DISPATCHED"] }
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      });
      const run = await transaction.automationRun.create({
        data: {
          automationId: automation.id,
          automationVersion: automation.version,
          workspaceId: automation.workspaceId,
          projectId: automation.projectId,
          status: active ? "SKIPPED" : "RUNNING",
          trigger: "MANUAL",
          scheduledFor: now,
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey,
          definition: automationDefinitionJson(definition),
          ...(active
            ? {
                errorCode: "OVERLAPPING_RUN",
                finishedAt: now
              }
            : { startedAt: now })
        }
      });
      return { automation, run };
    });
  }

  private async settleForAutomation(
    automationId: string
  ): Promise<void> {
    const runs = await this.prisma.automationRun.findMany({
      where: { automationId, status: "DISPATCHED" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 10
    });
    for (const run of runs) await this.settleRun(run);
  }

  private async settleRun(run: AutomationRun): Promise<boolean> {
    if (!run.jobId) return false;
    const job = await this.prisma.job.findFirst({
      where: {
        id: run.jobId,
        workspaceId: run.workspaceId,
        projectId: run.projectId
      },
      select: { status: true }
    });
    if (!job || !TERMINAL_JOB_STATUSES.has(job.status)) return false;
    const automation = await this.prisma.automation.findUnique({
      where: { id: run.automationId }
    });
    if (!automation) return false;
    if (SUCCESS_JOB_STATUSES.has(job.status)) {
      await this.prisma.$transaction(async (transaction) => {
        await lockAutomation(transaction, automation.id);
        const now = await databaseNow(transaction);
        const changed = await transaction.automationRun.updateMany({
          where: { id: run.id, status: "DISPATCHED" },
          data: {
            status: "COMPLETED",
            finishedAt: now
          }
        });
        if (changed.count === 1) {
          await transaction.automation.update({
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
      `JOB_${job.status}`,
      run.estimateId ?? undefined
    );
    return true;
  }

  private async fail(
    automation: Automation,
    run: AutomationRun,
    errorCode: string,
    estimateId?: string
  ): Promise<void> {
    const paused = await this.prisma.$transaction(async (transaction) => {
      await lockAutomation(transaction, automation.id);
      const current = await transaction.automation.findUnique({
        where: { id: automation.id }
      });
      if (!current) return false;
      const definition = storedAutomationDefinition(run.definition);
      const now = await databaseNow(transaction);
      const changed = await transaction.automationRun.updateMany({
        where: {
          id: run.id,
          automationId: automation.id,
          status: { in: ["RUNNING", "DISPATCHED"] }
        },
        data: {
          status: "FAILED",
          errorCode: boundedErrorCode(errorCode),
          ...(estimateId ? { estimateId } : {}),
          finishedAt: now
        }
      });
      if (changed.count === 0) return !current.enabled;
      const consecutiveErrors = current.consecutiveErr + 1;
      const autoPause =
        consecutiveErrors >= definition.failureThreshold;
      await transaction.automation.update({
        where: { id: current.id },
        data: {
          consecutiveErr: consecutiveErrors,
          ...(autoPause
            ? {
                enabled: false,
                pausedReason: "FAILURE_THRESHOLD",
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
        .removeRankAutomationScheduler(automation.id)
        .catch(() => undefined);
    }
  }
}

export function toAutomationRunSummary(
  run: AutomationRun
): AutomationRunSummary {
  return {
    id: run.id,
    automationId: run.automationId,
    automationVersion: run.automationVersion,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    status: run.status,
    trigger: run.trigger,
    scheduledFor: run.scheduledFor.toISOString(),
    ...(run.estimateId ? { estimateId: run.estimateId } : {}),
    ...(run.jobId ? { jobId: run.jobId } : {}),
    ...(run.errorCode ? { errorCode: run.errorCode } : {}),
    ...(run.startedAt
      ? { startedAt: run.startedAt.toISOString() }
      : {}),
    ...(run.finishedAt
      ? { finishedAt: run.finishedAt.toISOString() }
      : {}),
    createdAt: run.createdAt.toISOString()
  };
}

async function lockAutomation(
  transaction: Prisma.TransactionClient,
  automationId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`rank-automation:${automationId}`}, 0)
    )
  `;
}

async function databaseNow(
  transaction: Pick<Prisma.TransactionClient, "$queryRaw">
): Promise<Date> {
  const [clock] = await transaction.$queryRaw<
    readonly { readonly now: Date }[]
  >`SELECT clock_timestamp() AS "now"`;
  if (!clock?.now || Number.isNaN(clock.now.getTime())) {
    throw new Error("Unable to read automation database clock");
  }
  return clock.now;
}

function safeAutomationError(error: unknown): string {
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
