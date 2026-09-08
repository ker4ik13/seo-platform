import { Inject, Injectable } from "@nestjs/common";
import type {
  InternalRankCheckFinalizationReceipt,
  RankCheckFinalStatus,
  RankJobFailureCode
} from "@seo-platform/contracts";
import { rankCommandKeywordLimit } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { Prisma } from "../generated/prisma/client.js";
import type {
  Job,
  RankJobRun
} from "../generated/prisma/client.js";
import { databaseClock } from "../database/database-clock.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  RankManifestClient,
  RankManifestClientError
} from "../seo-data/rank-manifest.client.js";
import { lockRankJobGraph } from "./rank-job-lock.js";
import {
  storedRankManifestCommand,
  type RankManifestCommandBinding
} from "./rank-manifest-command.js";
import {
  MANUAL_RANK_CHECK_JOB_TYPE,
  rankJobFailureJson,
  rankJobResultJson
} from "./rank-job-record.js";
import { rankProviderRequestIntent } from "./rank-provider-request-intent.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const TERMINAL_EXECUTION_STATUSES = new Set([
  "PERSISTED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "SUBMIT_OUTCOME_UNKNOWN"
]);

export type RankResultFinalizationOutcome =
  | "IDLE"
  | "COMPLETED"
  | "PARTIALLY_COMPLETED"
  | "FAILED"
  | "ACTION_REQUIRED"
  | "RETRY_PENDING"
  | "LEASE_LOST";

interface RankFinalizationPlan {
  readonly status: Exclude<RankCheckFinalStatus, "CANCELLED">;
  readonly persistedCount: number;
  readonly failedCount: number;
  readonly submitOutcomeUnknownCount: number;
  readonly failureCode: RankJobFailureCode;
  readonly executions: readonly TerminalExecution[];
}

interface RankFinalizationClaim {
  readonly jobId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly manifestId: string;
  readonly trackingContextId: string;
  readonly configurationVersion: number;
  readonly pairCount: number;
  readonly leaseOwner: string;
  readonly jobVersion: number;
  readonly plan: RankFinalizationPlan;
}

interface TerminalExecution {
  readonly executionId: string;
  readonly jobItemId: string;
  readonly manifestChunkIndex: number;
  readonly status: string;
  readonly providerTaskId: string | null;
  readonly lastErrorCode: string | null;
  readonly keywordCount: number;
}

interface TerminalExecutionRow {
  readonly executionId: string;
  readonly jobItemId: string;
  readonly manifestChunkIndex: number;
  readonly status: string;
  readonly providerTaskId: string | null;
  readonly lastErrorCode: string | null;
  readonly requestSnapshot: unknown;
}

type RankJobWithRun = Job & {
  readonly rankRun: RankJobRun | null;
};

@Injectable()
export class RankResultFinalizationService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly manifests: RankManifestClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async pendingJobIds(
    limit = 20
  ): Promise<readonly string[]> {
    const boundedLimit =
      Number.isSafeInteger(limit) && limit > 0
        ? Math.min(limit, 100)
        : 20;
    const rows = await this.prisma.$queryRaw<
      readonly { readonly id: string }[]
    >`
      SELECT job."id"::text AS "id"
      FROM public.jobs job
      JOIN public.rank_job_runs run
        ON run."workspace_id" = job."workspace_id"
        AND run."project_id" = job."project_id"
        AND run."job_id" = job."id"
      WHERE job."type" = 'MANUAL_RANK_CHECK'
        AND job."status" = 'RUNNING'
        AND job."stage" IN ('WAITING_EXECUTION_GRANT', 'FINALIZING')
        AND (
          job."retry_at" IS NULL
          OR job."retry_at" <= clock_timestamp()
        )
        AND (
          job."lease_owner" IS NULL
          OR job."lease_expires_at" <= clock_timestamp()
        )
        AND run."seal_state" = 'SEALED'
        AND run."finalization_status" IS NULL
        AND run."manifest_chunk_count" BETWEEN 1 AND ${rankCommandKeywordLimit}
        AND (
          SELECT count(*)
          FROM (
            SELECT DISTINCT execution."job_item_id"
            FROM public.rank_connector_executions execution
            WHERE execution."workspace_id" = job."workspace_id"
              AND execution."project_id" = job."project_id"
              AND execution."job_id" = job."id"
          ) latest_execution
        ) = run."manifest_chunk_count"
        AND NOT EXISTS (
          SELECT 1
          FROM (
            SELECT DISTINCT ON (execution."job_item_id")
              execution."status"
            FROM public.rank_connector_executions execution
            WHERE execution."workspace_id" = job."workspace_id"
              AND execution."project_id" = job."project_id"
              AND execution."job_id" = job."id"
            ORDER BY
              execution."job_item_id",
              execution."execution_attempt" DESC,
              execution."id" DESC
          ) latest_execution
          WHERE latest_execution."status" NOT IN (
              'PERSISTED',
              'FAILED_RETRYABLE',
              'FAILED_FINAL',
              'SUBMIT_OUTCOME_UNKNOWN'
            )
        )
      ORDER BY job."created_at", job."id"
      LIMIT ${boundedLimit}
    `;
    return rows.map(({ id }) => id);
  }

  public async process(
    jobId: string,
    leaseOwner: string
  ): Promise<RankResultFinalizationOutcome> {
    const claim = await this.claim(jobId, leaseOwner);
    if (!claim) return "IDLE";
    try {
      const receipt = await this.manifests.finalize(
        {
          schemaVersion: "rank-finalize@1",
          workspaceId: claim.workspaceId,
          projectId: claim.projectId,
          actorId: claim.actorId,
          jobId: claim.jobId,
          manifestId: claim.manifestId,
          status: claim.plan.status
        },
        {
          trackingContextId: claim.trackingContextId,
          configurationVersion: claim.configurationVersion,
          pairCount: claim.pairCount
        }
      );
      await this.finish(claim, receipt);
      return claim.plan.status;
    } catch (error) {
      if (error instanceof RankFinalizationLeaseLostError) {
        return "LEASE_LOST";
      }
      await this.releaseForRetry(claim);
      if (
        error instanceof RankManifestClientError &&
        error.retryable
      ) {
        return "RETRY_PENDING";
      }
      throw error;
    }
  }

  private async claim(
    jobId: string,
    leaseOwner: string
  ): Promise<RankFinalizationClaim | undefined> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$/u.test(leaseOwner)) {
      throw new TypeError("Invalid rank finalization lease owner");
    }
    return this.prisma.$transaction(
      async (transaction) => {
        await lockRankJobGraph(transaction, jobId);
        const current = await findRankJob(transaction, jobId);
        const run = current?.rankRun;
        const now = await databaseClock(transaction);
        if (
          !current ||
          !run ||
          current.status !== "RUNNING" ||
          !["WAITING_EXECUTION_GRANT", "FINALIZING"].includes(
            current.stage ?? ""
          ) ||
          (current.retryAt && current.retryAt > now) ||
          (current.leaseOwner &&
            current.leaseExpiresAt &&
            current.leaseExpiresAt > now) ||
          current.projectId === null ||
          current.actorId === null ||
          run.sealState !== "SEALED" ||
          run.finalizationStatus !== null ||
          !run.manifestId ||
          !run.manifestPairCount ||
          !run.manifestChunkCount
        ) {
          return undefined;
        }
        const plan = await finalizationPlan(
          transaction,
          current,
          run.manifestPairCount,
          run.manifestChunkCount
        );
        if (!plan) return undefined;
        const command = storedRankManifestCommand(
          run.manifestCommand,
          run.manifestCommandHash,
          commandBinding(current)
        );
        const leaseExpiresAt = new Date(
          now.getTime() + this.leaseMilliseconds()
        );
        const changed = await transaction.job.updateMany({
          where: {
            id: current.id,
            status: "RUNNING",
            stage: current.stage,
            version: current.version
          },
          data: {
            stage: "FINALIZING",
            leaseOwner,
            leaseExpiresAt,
            retryAt: null,
            version: { increment: 1 }
          }
        });
        if (changed.count !== 1) return undefined;
        return {
          jobId: current.id,
          workspaceId: current.workspaceId,
          projectId: current.projectId,
          actorId: current.actorId,
          manifestId: run.manifestId,
          trackingContextId: run.trackingContextId,
          configurationVersion:
            command.estimate.configurationVersion,
          pairCount: run.manifestPairCount,
          leaseOwner,
          jobVersion: current.version + 1,
          plan
        };
      },
      { isolationLevel: "ReadCommitted" }
    );
  }

  private async finish(
    claim: RankFinalizationClaim,
    receipt: InternalRankCheckFinalizationReceipt
  ): Promise<void> {
    await this.prisma.$transaction(
      async (transaction) => {
        await lockRankJobGraph(transaction, claim.jobId);
        const current = await findRankJob(transaction, claim.jobId);
        const run = current?.rankRun;
        if (
          !current ||
          !run ||
          current.status !== "RUNNING" ||
          current.stage !== "FINALIZING" ||
          current.version !== claim.jobVersion ||
          current.leaseOwner !== claim.leaseOwner ||
          current.workspaceId !== receipt.workspaceId ||
          current.projectId !== receipt.projectId ||
          current.actorId !== claim.actorId ||
          run.sealState !== "SEALED" ||
          run.manifestId !== receipt.manifestId ||
          run.finalizationStatus !== null
        ) {
          throw new RankFinalizationLeaseLostError();
        }
        const plan = await finalizationPlan(
          transaction,
          current,
          claim.pairCount,
          claim.plan.executions.length
        );
        assertReceiptMatchesPlan(receipt, claim, plan);

        for (const execution of plan.executions) {
          const persisted = execution.status === "PERSISTED";
          const changed = await transaction.jobItem.updateMany({
            where: {
              id: execution.jobItemId,
              workspaceId: claim.workspaceId,
              projectId: claim.projectId,
              jobId: claim.jobId,
              sequence: execution.manifestChunkIndex,
              status: "QUEUED"
            },
            data: {
              status: persisted ? "COMPLETED" : "FAILED_FINAL",
              providerRequestId: execution.providerTaskId,
              outputReference: persisted
                ? {
                    schemaVersion: "rank-job-item-output@1",
                    manifestId: claim.manifestId,
                    chunkIndex: execution.manifestChunkIndex
                  }
                : Prisma.DbNull,
              actualCostMicro: 0n,
              error: persisted
                ? Prisma.DbNull
                : rankJobFailureJson(
                    execution.status === "SUBMIT_OUTCOME_UNKNOWN"
                      ? "SUBMIT_OUTCOME_UNKNOWN"
                      : failureCode(execution.lastErrorCode)
                  ),
              attempt: 1,
              retryAt: null
            }
          });
          if (changed.count !== 1) {
            throw new Error("Rank JobItem finalization race");
          }
        }

        const finalizedAt = new Date(receipt.finalizedAt);
        const runChanged = await transaction.rankJobRun.updateMany({
          where: {
            jobId: claim.jobId,
            sealState: "SEALED",
            manifestId: receipt.manifestId,
            finalizationStatus: null
          },
          data: {
            sealState: "FINALIZED",
            finalizationStatus: receipt.status,
            finalizationRequestHash: hashBytes(
              receipt.requestHash.value
            ),
            finalizedAt
          }
        });
        if (runChanged.count !== 1) {
          throw new Error("Rank result finalization race");
        }

        const jobStatus =
          receipt.status === "FAILED"
            ? "FAILED_FINAL"
            : receipt.status;
        const jobChanged = await transaction.job.updateMany({
          where: {
            id: claim.jobId,
            status: "RUNNING",
            stage: "FINALIZING",
            version: claim.jobVersion,
            leaseOwner: claim.leaseOwner
          },
          data: {
            status: jobStatus,
            stage:
              receipt.status === "ACTION_REQUIRED"
                ? "SUBMIT_OUTCOME_UNKNOWN"
                : "FINISHED",
            progressCurrent: BigInt(receipt.persistedCount),
            resultSummary: rankJobResultJson({
              pairCount: receipt.pairCount,
              persistedCount: receipt.persistedCount,
              foundCount: receipt.foundCount,
              notFoundCount: receipt.notFoundCount,
              failedCount: String(plan.failedCount),
              submitOutcomeUnknownCount: String(
                plan.submitOutcomeUnknownCount
              )
            }),
            errorSummary:
              receipt.status === "ACTION_REQUIRED"
                ? rankJobFailureJson("SUBMIT_OUTCOME_UNKNOWN")
                : receipt.status === "FAILED"
                  ? rankJobFailureJson(plan.failureCode)
                  : Prisma.DbNull,
            finishedAt: finalizedAt,
            leaseOwner: null,
            leaseExpiresAt: null,
            retryAt: null,
            version: { increment: 1 }
          }
        });
        if (jobChanged.count !== 1) {
          throw new Error("Rank Job finalization optimistic lock was lost");
        }
      },
      { isolationLevel: "ReadCommitted" }
    );
  }

  private async releaseForRetry(
    claim: RankFinalizationClaim
  ): Promise<void> {
    await this.prisma.job.updateMany({
      where: {
        id: claim.jobId,
        status: "RUNNING",
        stage: "FINALIZING",
        version: claim.jobVersion,
        leaseOwner: claim.leaseOwner
      },
      data: {
        leaseOwner: null,
        leaseExpiresAt: null,
        retryAt: new Date(Date.now() + 30_000),
        version: { increment: 1 }
      }
    });
  }

  private leaseMilliseconds(): number {
    return Math.min(
      300_000,
      Math.max(10_000, this.config.internalCommandTimeoutMs + 5_000)
    );
  }
}

async function finalizationPlan(
  transaction: Prisma.TransactionClient,
  job: RankJobWithRun,
  pairCount: number,
  chunkCount: number
): Promise<RankFinalizationPlan | undefined> {
  const rows = await transaction.$queryRaw<
    readonly TerminalExecutionRow[]
  >`
    WITH latest_execution AS (
      SELECT DISTINCT ON (execution."job_item_id")
        execution.*
      FROM public.rank_connector_executions execution
      WHERE execution."workspace_id" = ${job.workspaceId}::uuid
        AND execution."project_id" = ${job.projectId}::uuid
        AND execution."job_id" = ${job.id}::uuid
      ORDER BY
        execution."job_item_id",
        execution."execution_attempt" DESC,
        execution."id" DESC
    )
    SELECT
      execution."id"::text AS "executionId",
      execution."job_item_id"::text AS "jobItemId",
      execution."manifest_chunk_index" AS "manifestChunkIndex",
      execution."status"::text AS "status",
      execution."provider_task_id"::text AS "providerTaskId",
      execution."last_error_code"::text AS "lastErrorCode",
      intent."request_snapshot" AS "requestSnapshot"
    FROM latest_execution execution
    JOIN public.rank_provider_request_intents intent
      ON intent."workspace_id" = execution."workspace_id"
      AND intent."project_id" = execution."project_id"
      AND intent."job_id" = execution."job_id"
      AND intent."job_item_id" = execution."job_item_id"
      AND intent."id" = execution."provider_request_intent_id"
      AND intent."request_hash" =
        execution."provider_request_intent_hash"
    ORDER BY execution."manifest_chunk_index", execution."id"
  `;
  if (
    rows.length !== chunkCount ||
    rows.some(
      (row, index) =>
        row.manifestChunkIndex !== index ||
        !TERMINAL_EXECUTION_STATUSES.has(row.status)
    )
  ) {
    return undefined;
  }
  const executions = rows.map((row) => ({
    executionId: row.executionId,
    jobItemId: row.jobItemId,
    manifestChunkIndex: row.manifestChunkIndex,
    status: row.status,
    providerTaskId: row.providerTaskId,
    lastErrorCode: row.lastErrorCode,
    keywordCount: rankProviderRequestIntent(row.requestSnapshot)
      .keywords.length
  }));
  const total = executions.reduce(
    (sum, execution) => sum + execution.keywordCount,
    0
  );
  if (total !== pairCount) {
    throw new Error("Rank terminal execution pair count is invalid");
  }
  const persistedCount = sumKeywords(executions, "PERSISTED");
  const submitOutcomeUnknownCount = sumKeywords(
    executions,
    "SUBMIT_OUTCOME_UNKNOWN"
  );
  const failedCount =
    pairCount - persistedCount - submitOutcomeUnknownCount;
  const status: Exclude<RankCheckFinalStatus, "CANCELLED"> =
    submitOutcomeUnknownCount > 0
      ? "ACTION_REQUIRED"
      : persistedCount === pairCount
        ? "COMPLETED"
        : persistedCount > 0
          ? "PARTIALLY_COMPLETED"
          : "FAILED";
  return {
    status,
    persistedCount,
    failedCount,
    submitOutcomeUnknownCount,
    failureCode: aggregateFailureCode(executions),
    executions
  };
}

function assertReceiptMatchesPlan(
  receipt: InternalRankCheckFinalizationReceipt,
  claim: RankFinalizationClaim,
  plan: RankFinalizationPlan | undefined
): asserts plan is RankFinalizationPlan {
  if (
    !plan ||
    receipt.jobId !== claim.jobId ||
    receipt.manifestId !== claim.manifestId ||
    receipt.trackingContextId !== claim.trackingContextId ||
    receipt.configurationVersion !== claim.configurationVersion ||
    receipt.status !== plan.status ||
    Number(receipt.pairCount) !== claim.pairCount ||
    Number(receipt.persistedCount) !== plan.persistedCount ||
    Number(receipt.missingCount) !==
      plan.failedCount + plan.submitOutcomeUnknownCount
  ) {
    throw new Error("Rank finalization receipt does not match Jobs state");
  }
}

function sumKeywords(
  executions: readonly TerminalExecution[],
  status: string
): number {
  return executions
    .filter((execution) => execution.status === status)
    .reduce((sum, execution) => sum + execution.keywordCount, 0);
}

function aggregateFailureCode(
  executions: readonly TerminalExecution[]
): RankJobFailureCode {
  const codes = new Set(
    executions
      .filter((execution) => execution.status !== "PERSISTED")
      .map((execution) => execution.lastErrorCode)
  );
  if (codes.has("INVALID_CREDENTIAL")) {
    return "PROVIDER_AUTHENTICATION_FAILED";
  }
  if (codes.has("PROVIDER_RATE_LIMITED")) {
    return "PROVIDER_RATE_LIMITED";
  }
  if (
    codes.has("INVALID_PROVIDER_RESPONSE") ||
    codes.has("PROVIDER_PLAN_OR_REQUEST_REJECTED")
  ) {
    return "PROVIDER_RESPONSE_INVALID";
  }
  return "PROVIDER_TEMPORARY_FAILURE";
}

function failureCode(value: string | null): RankJobFailureCode {
  switch (value) {
    case "INVALID_CREDENTIAL":
      return "PROVIDER_AUTHENTICATION_FAILED";
    case "PROVIDER_RATE_LIMITED":
      return "PROVIDER_RATE_LIMITED";
    case "INVALID_PROVIDER_RESPONSE":
    case "PROVIDER_PLAN_OR_REQUEST_REJECTED":
      return "PROVIDER_RESPONSE_INVALID";
    default:
      return "PROVIDER_TEMPORARY_FAILURE";
  }
}

function findRankJob(
  transaction: Pick<Prisma.TransactionClient, "job">,
  jobId: string
): Promise<RankJobWithRun | null> {
  return transaction.job.findFirst({
    where: { id: jobId, type: MANUAL_RANK_CHECK_JOB_TYPE },
    include: { rankRun: true }
  });
}

function commandBinding(job: RankJobWithRun): RankManifestCommandBinding {
  const run = job.rankRun;
  if (
    !run ||
    job.projectId === null ||
    job.actorId === null ||
    job.progressTotal === null ||
    run.projectStatus !== "ACTIVE"
  ) {
    throw new Error("Manual rank Job has invalid command binding");
  }
  return {
    workspaceId: job.workspaceId,
    projectId: job.projectId,
    actorId: job.actorId,
    jobId: job.id,
    estimateId: run.estimateId,
    trackingContextId: run.trackingContextId,
    projectDomain: run.projectDomain,
    projectVersion: run.projectVersion,
    pairCount: job.progressTotal
  };
}

function hashBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!HASH_PATTERN.test(value)) {
    throw new Error("Invalid rank finalization hash");
  }
  return Uint8Array.from(Buffer.from(value, "hex"));
}

class RankFinalizationLeaseLostError extends Error {
  public constructor() {
    super("RANK_FINALIZATION_LEASE_LOST");
    this.name = "RankFinalizationLeaseLostError";
  }
}
