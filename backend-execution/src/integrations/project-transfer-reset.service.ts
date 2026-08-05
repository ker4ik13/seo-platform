import { ConflictException, Injectable } from "@nestjs/common";
import type { InternalProjectExecutionResetResult } from "@seo-platform/contracts";
import type { JobStatus, Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";

const ACTIVE_JOB_STATUSES = [
  "DRAFT",
  "ESTIMATING",
  "AWAITING_APPROVAL",
  "RESERVING_BALANCE",
  "PREPARING",
  "QUEUED",
  "WAITING_RATE_LIMIT",
  "RUNNING",
  "PAUSE_REQUESTED",
  "PAUSED",
  "CANCEL_REQUESTED",
  "RETRY_SCHEDULED",
  "FAILED_RETRYABLE"
] as const satisfies readonly JobStatus[];

const BLOCKING_IMPORT_STATUSES = [
  "QUEUED",
  "PARSING",
  "VALIDATING",
  "READY_TO_PUBLISH",
  "PUBLISHING",
  "CANCEL_REQUESTED"
] as const;

const DORMANT_IMPORT_STATUSES = [
  "AWAITING_MAPPING",
  "AWAITING_CONFIRMATION"
] as const;

@Injectable()
export class ProjectTransferResetService {
  public constructor(private readonly prisma: PrismaService) {}

  public async reset(
    workspaceId: string,
    projectId: string
  ): Promise<InternalProjectExecutionResetResult> {
    return this.prisma.$transaction(async (transaction) => {
      if ((await blockingOperationCount(transaction, workspaceId, projectId)) > 0) {
        throw new ConflictException({
          code: "PROJECT_TRANSFER_ACTIVE_OPERATIONS",
          message: "Stop active project operations before transferring it"
        });
      }

      const now = new Date();
      await transaction.semanticImport.updateMany({
        where: {
          workspaceId,
          projectId,
          status: { in: [...DORMANT_IMPORT_STATUSES] }
        },
        data: {
          status: "CANCELLED",
          stage: "cancelled",
          cancelRequestedAt: now,
          version: { increment: 1 }
        }
      });
      await transaction.automation.updateMany({
        where: { workspaceId, projectId },
        data: {
          enabled: false,
          pausedReason: "PROJECT_TRANSFER",
          nextRunAt: null,
          version: { increment: 1 }
        }
      });
      await transaction.crawlAutomation.updateMany({
        where: { workspaceId, projectId },
        data: {
          enabled: false,
          pausedReason: "PROJECT_TRANSFER",
          nextRunAt: null,
          version: { increment: 1 }
        }
      });
      await transaction.projectConnectorRoute.updateMany({
        where: { workspaceId, projectId, retiredAt: null },
        data: { retiredAt: now }
      });
      await transaction.projectConnectorBinding.updateMany({
        where: { workspaceId, projectId },
        data: {
          enabled: false,
          fallbackMode: "NONE",
          fallbackReasons: [],
          configurationScope: "PROJECT_OVERRIDE",
          workspaceBindingId: null,
          workspaceBindingVersion: null,
          version: { increment: 1 }
        }
      });
      if ((await blockingOperationCount(transaction, workspaceId, projectId)) > 0) {
        throw new ConflictException({
          code: "PROJECT_TRANSFER_ACTIVE_OPERATIONS",
          message: "A project operation started while transfer was being prepared"
        });
      }
      return { status: "RESET" };
    });
  }
}

async function blockingOperationCount(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  projectId: string
): Promise<number> {
  const [jobs, imports, automationRuns, crawlAutomationRuns] =
    await Promise.all([
      transaction.job.count({
        where: {
          workspaceId,
          projectId,
          status: { in: [...ACTIVE_JOB_STATUSES] }
        }
      }),
      transaction.semanticImport.count({
        where: {
          workspaceId,
          projectId,
          status: { in: [...BLOCKING_IMPORT_STATUSES] }
        }
      }),
      transaction.automationRun.count({
        where: {
          workspaceId,
          projectId,
          status: { in: ["RUNNING", "DISPATCHED"] }
        }
      }),
      transaction.crawlAutomationRun.count({
        where: {
          workspaceId,
          projectId,
          status: { in: ["RUNNING", "DISPATCHED"] }
        }
      })
    ]);
  return jobs + imports + automationRuns + crawlAutomationRuns;
}
