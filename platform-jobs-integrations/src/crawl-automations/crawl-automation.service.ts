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
  CrawlAutomationCollection,
  CrawlAutomationSummary,
  InternalCreateCrawlAutomationInput,
  InternalCrawlAutomationStatusInput,
  InternalUpdateCrawlAutomationInput
} from "@seo-platform/contracts";
import type {
  CrawlAutomation,
  Prisma
} from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { QueueService } from "../queue/queue.service.js";
import {
  crawlAutomationDefinition,
  crawlAutomationDefinitionJson,
  sameCrawlAutomationCommand,
  storedCrawlAutomationDefinition,
  toCrawlAutomationSummary
} from "./crawl-automation-record.js";

const LIST_LIMIT = 100;

@Injectable()
export class CrawlAutomationService {
  private readonly logger = new Logger(CrawlAutomationService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService
  ) {}

  public async create(
    input: InternalCreateCrawlAutomationInput
  ): Promise<CrawlAutomationSummary> {
    const replay = await this.findIdempotent(input);
    if (replay) {
      this.assertReplay(replay, input);
      return this.syncAfterCommit(replay);
    }
    let automation: CrawlAutomation;
    try {
      automation = await this.prisma.$transaction(async (transaction) => {
        await lockCapacity(transaction, input.workspaceId);
        const transactionReplay =
          await transaction.crawlAutomation.findUnique({
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
          await assertCapacity(
            transaction,
            input.workspaceId,
            input.entitlement
          );
        }
        return transaction.crawlAutomation.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            name: input.name,
            definition: crawlAutomationDefinitionJson(
              crawlAutomationDefinition(input)
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
  ): Promise<CrawlAutomationCollection> {
    const [automations, rankEnabled, crawlEnabled] = await Promise.all([
      this.prisma.crawlAutomation.findMany({
        where: { workspaceId, projectId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: LIST_LIMIT + 1
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
        .slice(0, LIST_LIMIT)
        .map(toCrawlAutomationSummary),
      limit,
      enabledCount: rankEnabled + crawlEnabled,
      truncated: automations.length > LIST_LIMIT
    };
  }

  public async update(
    input: InternalUpdateCrawlAutomationInput
  ): Promise<CrawlAutomationSummary> {
    const automation = await this.prisma.$transaction(
      async (transaction) => {
        await lockCapacity(transaction, input.workspaceId);
        const current = await requiredAutomation(transaction, input);
        assertVersion(current, input.expectedVersion);
        if (input.enabled && !current.enabled) {
          await assertCapacity(
            transaction,
            input.workspaceId,
            input.entitlement
          );
        }
        return transaction.crawlAutomation.update({
          where: { id: current.id },
          data: {
            name: input.name,
            definition: crawlAutomationDefinitionJson(
              crawlAutomationDefinition(input)
            ),
            timezone: input.timezone,
            enabled: input.enabled,
            pausedReason: input.enabled ? null : "MANUAL",
            ...(!input.enabled ? { nextRunAt: null } : {}),
            updatedBy: input.actorId,
            version: { increment: 1 }
          }
        });
      }
    );
    return this.syncAfterCommit(automation);
  }

  public async pause(
    input: InternalCrawlAutomationStatusInput
  ): Promise<CrawlAutomationSummary> {
    const automation = await this.prisma.$transaction(
      async (transaction) => {
        await lockCapacity(transaction, input.workspaceId);
        const current = await requiredAutomation(transaction, input);
        assertVersion(current, input.expectedVersion);
        return transaction.crawlAutomation.update({
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
    input: InternalCrawlAutomationStatusInput
  ): Promise<CrawlAutomationSummary> {
    const automation = await this.prisma.$transaction(
      async (transaction) => {
        await lockCapacity(transaction, input.workspaceId);
        const current = await requiredAutomation(transaction, input);
        assertVersion(current, input.expectedVersion);
        if (!current.enabled) {
          await assertCapacity(
            transaction,
            input.workspaceId,
            input.entitlement
          );
        }
        const definition = storedCrawlAutomationDefinition(
          current.definition
        );
        return transaction.crawlAutomation.update({
          where: { id: current.id },
          data: {
            enabled: true,
            pausedReason: null,
            definition: crawlAutomationDefinitionJson({
              ...definition,
              actorId: input.actorId
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
    const automations = await this.prisma.crawlAutomation.findMany({
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
    automation: CrawlAutomation
  ): Promise<CrawlAutomationSummary> {
    try {
      return await this.sync(automation);
    } catch {
      this.logger.error(
        "Crawl automation scheduler synchronization deferred"
      );
      return toCrawlAutomationSummary(automation);
    }
  }

  private async sync(
    automation: CrawlAutomation
  ): Promise<CrawlAutomationSummary> {
    try {
      if (!automation.enabled) {
        await this.queue.removeCrawlAutomationScheduler(automation.id);
        const current = await this.prisma.crawlAutomation.update({
          where: { id: automation.id },
          data: { nextRunAt: null }
        });
        return toCrawlAutomationSummary(current);
      }
      const definition = storedCrawlAutomationDefinition(
        automation.definition
      );
      const nextRunAt =
        await this.queue.upsertCrawlAutomationScheduler({
          automationId: automation.id,
          automationVersion: automation.version,
          schedule: definition.schedule,
          timezone: automation.timezone
        });
      await this.prisma.crawlAutomation.updateMany({
        where: {
          id: automation.id,
          version: automation.version,
          enabled: true
        },
        data: { nextRunAt }
      });
      const current = await this.prisma.crawlAutomation.findUnique({
        where: { id: automation.id }
      });
      if (!current) throw new NotFoundException("Automation not found");
      return toCrawlAutomationSummary(current);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        "Unable to synchronize the crawl automation scheduler",
        { cause: error }
      );
    }
  }

  private findIdempotent(
    input: InternalCreateCrawlAutomationInput
  ): Promise<CrawlAutomation | null> {
    return this.prisma.crawlAutomation.findUnique({
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
    automation: CrawlAutomation,
    input: InternalCreateCrawlAutomationInput
  ): void {
    if (sameCrawlAutomationCommand(automation, input)) return;
    throw new HttpException(
      {
        error: {
          code: "IDEMPOTENCY_CONFLICT",
          message:
            "Idempotency key was already used for another crawl automation"
        }
      },
      HttpStatus.CONFLICT
    );
  }
}

async function lockCapacity(
  transaction: Prisma.TransactionClient,
  workspaceId: string
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`billing-capacity:scheduled-automations:${workspaceId}`}, 0)
    )
  `;
}

async function assertCapacity(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  entitlement: AutomationCapacityEntitlement
): Promise<void> {
  const [rank, crawl] = await Promise.all([
    transaction.automation.count({ where: { workspaceId, enabled: true } }),
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
  input: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly automationId: string;
  }
): Promise<CrawlAutomation> {
  const automation = await transaction.crawlAutomation.findFirst({
    where: {
      id: input.automationId,
      workspaceId: input.workspaceId,
      projectId: input.projectId
    }
  });
  if (!automation) throw new NotFoundException("Automation not found");
  return automation;
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

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
