import { HttpException, HttpStatus } from "@nestjs/common";
import type { JobCapacityEntitlement } from "@seo-platform/contracts";
import type { Prisma } from "../generated/prisma/client.js";

export const ACTIVE_JOB_STATUSES = [
  "DRAFT",
  "ESTIMATING",
  "RESERVING_BALANCE",
  "PREPARING",
  "QUEUED",
  "WAITING_RATE_LIMIT",
  "RUNNING",
  "PAUSE_REQUESTED",
  "CANCEL_REQUESTED",
  "RETRY_SCHEDULED"
] as const;

export const ACTIVE_IMPORT_STATUSES = [
  "QUEUED",
  "PARSING",
  "VALIDATING",
  "READY_TO_PUBLISH",
  "PUBLISHING",
  "CANCEL_REQUESTED"
] as const;

/** Atomically reserves room for a new workspace task inside the Jobs DB. */
export async function assertJobCapacity(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  entitlement: JobCapacityEntitlement
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`workspace-job-capacity:${workspaceId}`}, 0)
    )
  `;
  const [jobs, imports] = await Promise.all([
    transaction.job.count({
      where: { workspaceId, status: { in: [...ACTIVE_JOB_STATUSES] } }
    }),
    transaction.semanticImport.count({
      where: { workspaceId, status: { in: [...ACTIVE_IMPORT_STATUSES] } }
    })
  ]);
  const current = jobs + imports;
  if (current < entitlement.concurrentJobs) return;
  throw new HttpException(
    {
      code: "QUOTA_EXCEEDED",
      message: "The concurrent task limit for the current workspace plan has been reached",
      details: {
        resource: "concurrentJobs",
        current,
        limit: entitlement.concurrentJobs,
        planCode: entitlement.planCode,
        planVersion: entitlement.planVersion
      }
    },
    HttpStatus.CONFLICT
  );
}
