import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import type {
  AutomationCapacityEntitlement,
  InternalAutomationStatusInput,
  InternalCreateRankTrackingAutomationInput,
  InternalUpdateRankTrackingAutomationInput,
  RankTrackingAutomationCollection,
  RankTrackingAutomationSummary
} from "@seo-platform/contracts";
import type {
  Automation,
  Prisma
} from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { QueueService } from "../queue/queue.service.js";
import {
  automationDefinition,
  automationDefinitionJson,
  sameAutomationCommand,
  storedAutomationDefinition,
  toAutomationSummary
} from "./automation-record.js";

const AUTOMATION_LIST_LIMIT = 100;

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService
  ) {}

  public async create(
    input: InternalCreateRankTrackingAutomationInput
  ): Promise<RankTrackingAutomationSummary> {
    const replay = await this.findIdempotent(input);
    if (replay) {
      this.assertReplay(replay, input);
      return this.syncAfterCommit(replay);
    }
    let automation: Automation;
    try {
      automation = await this.prisma.$transaction(async (transaction) => {
        await lockAutomationCapacity(transaction, input.workspaceId);
        const transactionReplay = await transaction.automation.findUnique({
          where: {
            workspaceId_createdBy_idempotencyKey: {
              workspaceId: input.workspaceId,
              createdBy: input.actorId,
              idempotencyKey: input.idempotencyKey
            }
          }
        });
        if (transactionReplay) {
          this.assertReplay(transactionReplay, input);
          return transactionReplay;
        }
        if (input.enabled) {
          await assertAutomationCapacity(
            transaction,
            input.workspaceId,
            input.entitlement
          );
        }
        return transaction.automation.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            name: input.name,
            definition: automationDefinitionJson(
              automationDefinition(input)
            ),
            timezone: input.timezone,
            enabled: input.enabled,
            pausedReason: input.enabled ? null : "MANUAL",
            createdBy: input.actorId,
            updatedBy: input.actorId,
            idempotencyKey: input.idempotencyKey
          }
        });
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const winner = await this.findIdempotent(input);
      if (!winner) throw error;
      this.assertReplay(winner, input);
      automation = winner;
    }
    return this.syncAfterCommit(automation);
  }

  public async list(
    workspaceId: string,
    projectId: string,
    limit: number
  ): Promise<RankTrackingAutomationCollection> {
    const [automations, rankEnabled, crawlEnabled] = await Promise.all([
      this.prisma.automation.findMany({
        where: { workspaceId, projectId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: AUTOMATION_LIST_LIMIT + 1
      }),
      this.prisma.automation.count({
        where: { workspaceId, enabled: true }
      }),
      this.prisma.crawlAutomation.count({
        where: { workspaceId, enabled: true }
      })
    ]);
    return {
      automations: automations
        .slice(0, AUTOMATION_LIST_LIMIT)
        .map(toAutomationSummary),
      limit,
      enabledCount: rankEnabled + crawlEnabled,
      truncated: automations.length > AUTOMATION_LIST_LIMIT
    };
  }

  public async update(
    input: InternalUpdateRankTrackingAutomationInput
  ): Promise<RankTrackingAutomationSummary> {
    const automation = await this.prisma.$transaction(
      async (transaction) => {
        await lockAutomationCapacity(transaction, input.workspaceId);
        const current = await requiredAutomation(
          transaction,
          input.workspaceId,
          input.projectId,
          input.automationId
        );
        assertVersion(current, input.expectedVersion);
        if (input.enabled && !current.enabled) {
          await assertAutomationCapacity(
            transaction,
            input.workspaceId,
            input.entitlement
          );
        }
        return transaction.automation.update({
          where: { id: current.id },
          data: {
            name: input.name,
            definition: automationDefinitionJson(
              automationDefinition(input)
            ),
            timezone: input.timezone,
            enabled: input.enabled,
            pausedReason: input.enabled ? null : "MANUAL",
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
      }
    );
    return this.syncAfterCommit(automation);
  }

  public async pause(
    input: InternalAutomationStatusInput
  ): Promise<RankTrackingAutomationSummary> {
    const automation = await this.prisma.$transaction(
      async (transaction) => {
        await lockAutomationCapacity(transaction, input.workspaceId);
        const current = await requiredAutomation(
          transaction,
          input.workspaceId,
          input.projectId,
          input.automationId
        );
        assertVersion(current, input.expectedVersion);
        return transaction.automation.update({
          where: { id: current.id },
          data: {
            enabled: false,
            pausedReason: "MANUAL",
            nextRunAt: null,
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
      }
    );
    return this.syncAfterCommit(automation);
  }

  public async resume(
    input: InternalAutomationStatusInput
  ): Promise<RankTrackingAutomationSummary> {
    const automation = await this.prisma.$transaction(
      async (transaction) => {
        await lockAutomationCapacity(transaction, input.workspaceId);
        const current = await requiredAutomation(
          transaction,
          input.workspaceId,
          input.projectId,
          input.automationId
        );
        assertVersion(current, input.expectedVersion);
        if (!current.enabled) {
          await assertAutomationCapacity(
            transaction,
            input.workspaceId,
            input.entitlement
          );
        }
        const definition = storedAutomationDefinition(
          current.definition
        );
        if (
          definition.schedule.cadence === "ONCE" &&
          Date.parse(definition.schedule.runAt) <= Date.now()
        ) {
          throw new HttpException(
            {
              error: {
                code: "RESOURCE_STATE_CONFLICT",
                message: "A completed one-time automation must be rescheduled"
              }
            },
            HttpStatus.CONFLICT
          );
        }
        return transaction.automation.update({
          where: { id: current.id },
          data: {
            enabled: true,
            pausedReason: null,
            definition: automationDefinitionJson({
              ...definition,
              execution: {
                actorId: input.actorId,
                project: input.project,
                access: input.access,
                billingCurrency: input.billingCurrency,
                jobCapacity: input.jobCapacity
              }
            }),
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
      }
    );
    return this.syncAfterCommit(automation);
  }

  public async reconcileSchedulers(limit = 100): Promise<number> {
    const automations = await this.prisma.automation.findMany({
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: Math.min(Math.max(limit, 1), 500)
    });
    let synchronized = 0;
    for (const automation of automations) {
      try {
        await this.sync(automation);
        synchronized += 1;
      } catch {
        // A later bounded reconciliation retries the durable DB definition.
      }
    }
    return synchronized;
  }

  private async syncAfterCommit(
    automation: Automation
  ): Promise<RankTrackingAutomationSummary> {
    try {
      return await this.sync(automation);
    } catch {
      this.logger.error(
        "Automation scheduler synchronization deferred"
      );
      return toAutomationSummary(automation);
    }
  }

  private async sync(
    automation: Automation
  ): Promise<RankTrackingAutomationSummary> {
    try {
      if (!automation.enabled) {
        await this.queue.removeRankAutomationScheduler(automation.id);
        const current = await this.prisma.automation.update({
          where: { id: automation.id },
          data: { nextRunAt: null }
        });
        return toAutomationSummary(current);
      }
      const definition = storedAutomationDefinition(
        automation.definition
      );
      const nextRunAt =
        await this.queue.upsertRankAutomationScheduler({
          automationId: automation.id,
          automationVersion: automation.version,
          schedule: definition.schedule,
          timezone: automation.timezone
        });
      await this.prisma.automation.updateMany({
        where: {
          id: automation.id,
          version: automation.version,
          enabled: true
        },
        data: { nextRunAt }
      });
      const current = await this.prisma.automation.findUnique({
        where: { id: automation.id }
      });
      if (!current) throw new NotFoundException("Automation not found");
      return toAutomationSummary(current);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        "Unable to synchronize the automation scheduler",
        { cause: error }
      );
    }
  }

  private findIdempotent(
    input: InternalCreateRankTrackingAutomationInput
  ): Promise<Automation | null> {
    return this.prisma.automation.findUnique({
      where: {
        workspaceId_createdBy_idempotencyKey: {
          workspaceId: input.workspaceId,
          createdBy: input.actorId,
          idempotencyKey: input.idempotencyKey
        }
      }
    });
  }

  private assertReplay(
    automation: Automation,
    input: InternalCreateRankTrackingAutomationInput
  ): void {
    if (sameAutomationCommand(automation, input)) return;
    throw new HttpException(
      {
        error: {
          code: "IDEMPOTENCY_CONFLICT",
          message:
            "Idempotency key was already used for another automation"
        }
      },
      HttpStatus.CONFLICT
    );
  }
}

async function lockAutomationCapacity(
  transaction: Prisma.TransactionClient,
  workspaceId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`billing-capacity:scheduled-automations:${workspaceId}`}, 0)
    )
  `;
}

async function assertAutomationCapacity(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  entitlement: AutomationCapacityEntitlement
): Promise<void> {
  const [rank, crawl] = await Promise.all([
    transaction.automation.count({
      where: { workspaceId, enabled: true }
    }),
    transaction.crawlAutomation.count({
      where: { workspaceId, enabled: true }
    })
  ]);
  const current = rank + crawl;
  if (current < entitlement.scheduledAutomations) return;
  throw new HttpException(
    {
      error: {
        code: "QUOTA_EXCEEDED",
        message:
          "The scheduledAutomations limit for the current plan would be exceeded",
        details: {
          resource: "scheduledAutomations",
          current: String(current),
          additional: "1",
          limit: String(entitlement.scheduledAutomations),
          planCode: entitlement.planCode,
          planVersion: entitlement.planVersion
        }
      }
    },
    HttpStatus.CONFLICT
  );
}

async function requiredAutomation(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string,
  automationId: string
): Promise<Automation> {
  const automation = await transaction.automation.findFirst({
    where: { id: automationId, workspaceId, projectId }
  });
  if (!automation) throw new NotFoundException("Automation not found");
  return automation;
}

function assertVersion(automation: Automation, expectedVersion: number): void {
  if (automation.version === expectedVersion) return;
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

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
