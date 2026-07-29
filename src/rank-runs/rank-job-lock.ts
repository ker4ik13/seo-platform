import { Prisma } from "../generated/prisma/client.js";
import { MANUAL_RANK_CHECK_JOB_TYPE } from "./rank-job-record.js";

export interface LockedRankJobIdentity {
  readonly jobId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

export async function lockRankJobGraph(
  transaction: Prisma.TransactionClient,
  jobId: string
): Promise<LockedRankJobIdentity | undefined> {
  const [identity] = await transaction.$queryRaw<
    readonly {
      readonly jobId: string;
      readonly workspaceId: string;
      readonly projectId: string;
    }[]
  >`
    /* rank-job-graph:job */
    SELECT
      j."id"::text AS "jobId",
      j."workspace_id"::text AS "workspaceId",
      j."project_id"::text AS "projectId"
    FROM "jobs" j
    WHERE j."id" = ${jobId}::uuid
      AND j."type" = ${MANUAL_RANK_CHECK_JOB_TYPE}
      AND j."project_id" IS NOT NULL
    FOR UPDATE OF j
  `;
  if (!identity) return undefined;
  await lockRankRun(transaction, identity);
  return identity;
}

export async function lockTenantRankJobGraph(
  transaction: Prisma.TransactionClient,
  identity: LockedRankJobIdentity
): Promise<boolean> {
  const rows = await transaction.$queryRaw<
    readonly { readonly jobId: string }[]
  >`
    /* rank-job-graph:job-tenant */
    SELECT j."id"::text AS "jobId"
    FROM "jobs" j
    WHERE j."id" = ${identity.jobId}::uuid
      AND j."workspace_id" = ${identity.workspaceId}::uuid
      AND j."project_id" = ${identity.projectId}::uuid
      AND j."type" = ${MANUAL_RANK_CHECK_JOB_TYPE}
    FOR UPDATE OF j
  `;
  if (rows.length === 0) return false;
  await lockRankRun(transaction, identity);
  return true;
}

async function lockRankRun(
  transaction: Prisma.TransactionClient,
  identity: LockedRankJobIdentity
): Promise<void> {
  const rows = await transaction.$queryRaw<
    readonly { readonly jobId: string }[]
  >`
    /* rank-job-graph:run */
    SELECT r."job_id"::text AS "jobId"
    FROM "rank_job_runs" r
    WHERE r."job_id" = ${identity.jobId}::uuid
      AND r."workspace_id" = ${identity.workspaceId}::uuid
      AND r."project_id" = ${identity.projectId}::uuid
    FOR UPDATE OF r
  `;
  if (rows.length !== 1) {
    throw new Error("Manual rank Job graph is incomplete");
  }
}
