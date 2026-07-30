import { Prisma } from "../generated/prisma/client.js";
import { MANUAL_RANK_CHECK_JOB_TYPE } from "./rank-job-record.js";

export interface LockedRankJobIdentity {
  readonly jobId: string;
  readonly workspaceId: string;
  readonly projectId: string;
}

export interface RankExecutionProjectionIdentity
  extends LockedRankJobIdentity {
  readonly jobItemId: string;
  readonly credentialId: string;
  readonly validationJobId: string;
  readonly bindingId: string;
  readonly routeId: string;
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

/**
 * Continues the canonical rank execution lock order after Job → RankJobRun.
 * The item is locked before any connector/vault state so cancellation always
 * wins or loses on the parent Job, never on a child-row deadlock.
 */
export async function lockRankJobItem(
  transaction: Prisma.TransactionClient,
  identity: LockedRankJobIdentity,
  jobItemId: string
): Promise<boolean> {
  const rows = await transaction.$queryRaw<
    readonly { readonly jobItemId: string }[]
  >`
    /* rank-job-graph:item */
    SELECT i."id"::text AS "jobItemId"
    FROM "job_items" i
    WHERE i."id" = ${jobItemId}::uuid
      AND i."job_id" = ${identity.jobId}::uuid
      AND i."workspace_id" = ${identity.workspaceId}::uuid
      AND i."project_id" = ${identity.projectId}::uuid
    FOR UPDATE OF i
  `;
  return rows.length === 1;
}

/**
 * Locks mutable private authorization evidence in the order already used by
 * connector-binding changes and validation completion:
 * credential → validation Job → binding → route.
 */
export async function lockRankExecutionProjection(
  transaction: Prisma.TransactionClient,
  identity: RankExecutionProjectionIdentity
): Promise<boolean> {
  const credentials = await transaction.$queryRaw<
    readonly { readonly id: string }[]
  >`
    /* rank-execution-graph:credential */
    SELECT c."id"::text AS "id"
    FROM "integration_credentials" c
    WHERE c."id" = ${identity.credentialId}::uuid
      AND c."workspace_id" = ${identity.workspaceId}::uuid
    FOR UPDATE OF c
  `;
  if (credentials.length !== 1) return false;

  const validations = await transaction.$queryRaw<
    readonly { readonly id: string }[]
  >`
    /* rank-execution-graph:validation-job */
    SELECT j."id"::text AS "id"
    FROM "jobs" j
    WHERE j."id" = ${identity.validationJobId}::uuid
      AND j."workspace_id" = ${identity.workspaceId}::uuid
    FOR UPDATE OF j
  `;
  if (validations.length !== 1) return false;

  const bindings = await transaction.$queryRaw<
    readonly { readonly id: string }[]
  >`
    /* rank-execution-graph:binding */
    SELECT b."id"::text AS "id"
    FROM "project_connector_bindings" b
    WHERE b."id" = ${identity.bindingId}::uuid
      AND b."workspace_id" = ${identity.workspaceId}::uuid
      AND b."project_id" = ${identity.projectId}::uuid
    FOR UPDATE OF b
  `;
  if (bindings.length !== 1) return false;

  const routes = await transaction.$queryRaw<
    readonly { readonly id: string }[]
  >`
    /* rank-execution-graph:route */
    SELECT r."id"::text AS "id"
    FROM "project_connector_routes" r
    WHERE r."id" = ${identity.routeId}::uuid
      AND r."workspace_id" = ${identity.workspaceId}::uuid
      AND r."project_id" = ${identity.projectId}::uuid
      AND r."binding_id" = ${identity.bindingId}::uuid
      AND r."credential_id" = ${identity.credentialId}::uuid
    FOR UPDATE OF r
  `;
  return routes.length === 1;
}

/**
 * Completes the execution authorization lock order after the mutable private
 * projection. Grant rows are always children of the already locked
 * Job → RankJobRun → JobItem graph.
 */
export async function lockRankExecutionGrantAttempt(
  transaction: Prisma.TransactionClient,
  identity: LockedRankJobIdentity,
  jobItemId: string,
  attemptId: string
): Promise<boolean> {
  const rows = await transaction.$queryRaw<
    readonly { readonly id: string }[]
  >`
    /* rank-execution-graph:grant-attempt */
    SELECT a."id"::text AS "id"
    FROM "rank_execution_grant_attempts" a
    WHERE a."id" = ${attemptId}::uuid
      AND a."workspace_id" = ${identity.workspaceId}::uuid
      AND a."project_id" = ${identity.projectId}::uuid
      AND a."job_id" = ${identity.jobId}::uuid
      AND a."job_item_id" = ${jobItemId}::uuid
    FOR UPDATE OF a
  `;
  return rows.length === 1;
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
