import { Inject, Injectable, Logger } from "@nestjs/common";
import type { RankJobFailureCode } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { Prisma } from "../generated/prisma/client.js";
import type {
  Job,
  RankJobRun
} from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  RankManifestClient,
  RankManifestClientError
} from "../seo-data/rank-manifest.client.js";
import {
  RankExecutionGrantAttemptError,
  RankExecutionGrantAttemptService
} from "./rank-execution-grant-attempt.service.js";
import { lockRankJobGraph } from "./rank-job-lock.js";
import {
  storedRankManifestCommand,
  type RankManifestCommandBinding
} from "./rank-manifest-command.js";
import {
  MANUAL_RANK_CHECK_JOB_TYPE,
  rankJobFailureJson
} from "./rank-job-record.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const RANK_PROVIDER_ACTIVE_TASK_LIMIT = 5;

export type RankExecutionDispatchOutcome =
  | "DISABLED"
  | "IDLE"
  | "RETRY_PENDING"
  | "READY_TO_SUBMIT"
  | "FAILED";

interface DispatchableRankJob {
  readonly jobId: string;
  readonly itemIds: readonly string[];
  readonly invalid: boolean;
}

type RankJobWithRun = Job & {
  readonly rankRun: RankJobRun | null;
};

@Injectable()
export class RankExecutionDispatchService {
  private readonly logger = new Logger(RankExecutionDispatchService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly grants: RankExecutionGrantAttemptService,
    private readonly manifests: RankManifestClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  /**
   * PostgreSQL is the recovery source of truth. A BullMQ notification is not
   * needed for this short authorization phase, and an already-created
   * connector execution makes an item disappear from this scan.
   */
  public async pendingExecutionJobIds(
    limit = 20
  ): Promise<readonly string[]> {
    if (!this.config.rankPreparation.enabled) return [];
    const boundedLimit = pendingLimit(limit);
    const rows = await this.prisma.$queryRaw<
      readonly { readonly id: string }[]
    >`
      SELECT j."id"::text AS "id"
      FROM "jobs" j
      JOIN "rank_job_runs" r
        ON r."job_id" = j."id"
       AND r."workspace_id" = j."workspace_id"
       AND r."project_id" = j."project_id"
      WHERE j."type" = 'MANUAL_RANK_CHECK'
        AND (
          (
            j."status" = 'QUEUED'
            AND j."stage" = 'WAITING_FOR_QUEUE'
          )
          OR
          (
            j."status" = 'RUNNING'
            AND j."stage" = 'WAITING_EXECUTION_GRANT'
          )
        )
        AND j."cancel_requested_at" IS NULL
        AND r."seal_state" = 'SEALED'
        AND r."finalization_status" IS NULL
        AND EXISTS (
          SELECT 1
          FROM "job_items" item
          LEFT JOIN "rank_connector_executions" execution
            ON execution."workspace_id" = item."workspace_id"
           AND execution."project_id" = item."project_id"
           AND execution."job_id" = item."job_id"
           AND execution."job_item_id" = item."id"
          WHERE item."workspace_id" = j."workspace_id"
            AND item."project_id" = j."project_id"
            AND item."job_id" = j."id"
            AND item."status" = 'QUEUED'
            AND execution."id" IS NULL
        )
      ORDER BY j."priority" ASC, j."created_at" ASC, j."id" ASC
      LIMIT ${boundedLimit}
    `;
    return rows.map(({ id }) => id);
  }

  public async process(
    jobId: string
  ): Promise<RankExecutionDispatchOutcome> {
    if (!this.config.rankPreparation.enabled) return "DISABLED";
    const dispatchable = await this.start(jobId);
    if (!dispatchable) return "IDLE";
    if (dispatchable.invalid) {
      await this.finishFailure(jobId, "INTERNAL_ERROR");
      return "FAILED";
    }
    if (dispatchable.itemIds.length === 0) return "RETRY_PENDING";

    for (const itemId of dispatchable.itemIds) {
      try {
        const result = await this.grants.issueForItem(
          itemId,
          `rank-grant-${itemId}`
        );
        if (result.status === "CONSUMED") continue;
        if (
          result.status === "DENIED" ||
          result.status === "REJECTED_LOCAL"
        ) {
          await this.finishFailure(
            dispatchable.jobId,
            "EXECUTION_GRANT_DENIED"
          );
          return "FAILED";
        }
        return "RETRY_PENDING";
      } catch (error) {
        if (error instanceof RankExecutionGrantAttemptError) {
          this.logger.error(
            JSON.stringify({
              event: "rank_execution_grant_failed",
              jobId: dispatchable.jobId,
              itemId,
              code: error.code,
              retryable: error.retryable,
              detail: error.detail ?? "unspecified"
            })
          );
        }
        if (
          error instanceof RankExecutionGrantAttemptError &&
          error.code === "SUBMIT_DISABLED"
        ) {
          return "DISABLED";
        }
        if (
          error instanceof RankExecutionGrantAttemptError &&
          error.retryable
        ) {
          return "RETRY_PENDING";
        }
        await this.finishFailure(
          dispatchable.jobId,
          error instanceof RankExecutionGrantAttemptError &&
            error.code === "DECISION_REJECTED"
            ? "EXECUTION_GRANT_DENIED"
            : "INTERNAL_ERROR"
        );
        return "FAILED";
      }
    }
    return "READY_TO_SUBMIT";
  }

  private async start(
    jobId: string
  ): Promise<DispatchableRankJob | undefined> {
    return this.prisma.$transaction(
      async (transaction) => {
        const identity = await lockRankJobGraph(transaction, jobId);
        if (!identity) return undefined;
        let job = await findRankJob(transaction, jobId);
        if (!job) return undefined;
        if (
          job.status === "QUEUED" &&
          job.stage === "WAITING_FOR_QUEUE"
        ) {
          const [clock] = await transaction.$queryRaw<
            readonly { readonly now: Date }[]
          >`SELECT clock_timestamp() AS "now"`;
          if (!clock?.now) {
            throw new Error("Unable to read Jobs database clock");
          }
          const changed = await transaction.job.updateMany({
            where: {
              id: job.id,
              type: MANUAL_RANK_CHECK_JOB_TYPE,
              status: "QUEUED",
              stage: "WAITING_FOR_QUEUE",
              version: job.version,
              cancelRequestedAt: null
            },
            data: {
              status: "RUNNING",
              stage: "WAITING_EXECUTION_GRANT",
              startedAt: clock.now,
              version: { increment: 1 }
            }
          });
          if (changed.count !== 1) return undefined;
          job = await findRankJob(transaction, jobId);
          if (!job) return undefined;
        }
        if (
          job.status !== "RUNNING" ||
          job.stage !== "WAITING_EXECUTION_GRANT" ||
          job.cancelRequestedAt !== null
        ) {
          return undefined;
        }
        const run = job.rankRun;
        const items = await transaction.jobItem.findMany({
          where: {
            workspaceId: identity.workspaceId,
            projectId: identity.projectId,
            jobId
          },
          orderBy: { sequence: "asc" },
          select: { id: true, sequence: true, status: true }
        });
        const executions =
          await transaction.rankConnectorExecution.findMany({
            where: {
              workspaceId: identity.workspaceId,
              projectId: identity.projectId,
              jobId
            },
            select: { jobItemId: true }
          });
        const provider = job.provider;
        const invalid =
          !run ||
          (provider !== "ARSENKIN" && provider !== "XMLSTOCK") ||
          run.sealState !== "SEALED" ||
          run.finalizationStatus !== null ||
          run.manifestChunkCount === null ||
          items.length !== run.manifestChunkCount ||
          items.some(({ sequence }, index) => sequence !== index);
        if (invalid) {
          return { jobId, itemIds: [], invalid: true };
        }
        if (provider !== "ARSENKIN" && provider !== "XMLSTOCK") {
          return { jobId, itemIds: [], invalid: true };
        }
        const capacity = await rankExecutionDispatchCapacity(
          transaction,
          provider
        );
        const executionItemIds = new Set(
          executions.map(({ jobItemId }) => jobItemId)
        );
        return {
          jobId,
          itemIds: items
            .filter(
              ({ id, status }) =>
                status === "QUEUED" && !executionItemIds.has(id)
            )
            .slice(0, capacity)
            .map(({ id }) => id),
          invalid: false
        };
      },
      { isolationLevel: "ReadCommitted" }
    );
  }

  private async finishFailure(
    jobId: string,
    failureCode: RankJobFailureCode
  ): Promise<void> {
    const stored = await this.prisma.$transaction(
      async (transaction) => {
        await lockRankJobGraph(transaction, jobId);
        const current = await findRankJob(transaction, jobId);
        if (
          !current ||
          !current.rankRun ||
          current.projectId === null ||
          current.actorId === null ||
          !["QUEUED", "RUNNING", "CANCEL_REQUESTED"].includes(
            current.status
          ) ||
          current.rankRun.sealState !== "SEALED" ||
          current.rankRun.finalizationStatus !== null
        ) {
          return undefined;
        }
        const unsafeExecution =
          await transaction.rankConnectorExecution.findFirst({
            where: {
              workspaceId: current.workspaceId,
              projectId: current.projectId,
              jobId,
              status: { in: ["CLAIMED", "SUBMITTING"] }
            },
            select: { id: true }
          });
        if (unsafeExecution) {
          throw new Error(
            "Cannot finalize a rank grant failure after connector claim"
          );
        }
        return current;
      },
      { isolationLevel: "ReadCommitted" }
    );
    if (!stored?.rankRun || stored.projectId === null || !stored.actorId) {
      return;
    }
    const run = stored.rankRun;
    if (
      !run.manifestId ||
      !run.manifestPairCount ||
      run.manifestPairCount < 1
    ) {
      throw new Error("Rank failure manifest is incomplete");
    }
    const command = storedRankManifestCommand(
      run.manifestCommand,
      run.manifestCommandHash,
      commandBinding(stored)
    );
    let receipt: Awaited<ReturnType<RankManifestClient["finalize"]>>;
    try {
      receipt = await this.manifests.finalize(
        {
          schemaVersion: "rank-finalize@1",
          workspaceId: stored.workspaceId,
          projectId: stored.projectId,
          actorId: stored.actorId,
          jobId: stored.id,
          manifestId: run.manifestId,
          status: "FAILED"
        },
        {
          trackingContextId: run.trackingContextId,
          configurationVersion: command.estimate.configurationVersion,
          pairCount: run.manifestPairCount
        }
      );
    } catch (error) {
      if (
        error instanceof RankManifestClientError &&
        error.retryable
      ) {
        throw error;
      }
      throw new Error("Unable to finalize failed rank execution", {
        cause: error
      });
    }

    await this.prisma.$transaction(
      async (transaction) => {
        await lockRankJobGraph(transaction, jobId);
        const current = await findRankJob(transaction, jobId);
        if (
          !current ||
          !current.rankRun ||
          current.projectId !== receipt.projectId ||
          current.rankRun.sealState !== "SEALED" ||
          current.rankRun.manifestId !== receipt.manifestId ||
          current.rankRun.finalizationStatus !== null ||
          !["QUEUED", "RUNNING", "CANCEL_REQUESTED"].includes(
            current.status
          )
        ) {
          return;
        }
        const runChanged = await transaction.rankJobRun.updateMany({
          where: {
            jobId,
            sealState: "SEALED",
            manifestId: receipt.manifestId,
            finalizationStatus: null
          },
          data: {
            sealState: "FINALIZED",
            finalizationStatus: "FAILED",
            finalizationRequestHash: hashBytes(
              receipt.requestHash.value
            ),
            finalizedAt: new Date(receipt.finalizedAt)
          }
        });
        if (runChanged.count !== 1) {
          throw new Error("Rank failure finalization race");
        }
        const changed = await transaction.job.updateMany({
          where: {
            id: current.id,
            type: MANUAL_RANK_CHECK_JOB_TYPE,
            status: current.status,
            version: current.version
          },
          data: {
            status: "FAILED_FINAL",
            stage: "FINISHED",
            progressCurrent: 0n,
            resultSummary: Prisma.DbNull,
            errorSummary: rankJobFailureJson(failureCode),
            finishedAt: new Date(receipt.finalizedAt),
            leaseOwner: null,
            leaseExpiresAt: null,
            retryAt: null,
            version: { increment: 1 }
          }
        });
        if (changed.count !== 1) {
          throw new Error("Rank failure Job optimistic lock was lost");
        }
      },
      { isolationLevel: "ReadCommitted" }
    );
  }
}

async function rankExecutionDispatchCapacity(
  transaction: Prisma.TransactionClient,
  provider: "ARSENKIN" | "XMLSTOCK"
): Promise<number> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${`seo-platform:rank-dispatch:${provider}`}::text,
        0
      )
    )
  `;
  const rows = await transaction.$queryRaw<
    readonly { readonly activeTaskCount: bigint }[]
  >`
    SELECT (
      (
        SELECT COUNT(*)
        FROM "rank_connector_executions" execution
        JOIN "jobs" rank_job
          ON rank_job."workspace_id" = execution."workspace_id"
         AND rank_job."project_id" = execution."project_id"
         AND rank_job."id" = execution."job_id"
        WHERE execution."provider" = ${provider}
          AND rank_job."status" = 'RUNNING'
          AND rank_job."cancel_requested_at" IS NULL
          AND (
            execution."status" IN ('SUBMITTING', 'POLL_WAIT')
            OR (
              execution."status" = 'READY_TO_SUBMIT'
              AND execution."authorization_expires_at" > clock_timestamp()
            )
            OR (
              execution."status" = 'CLAIMED'
              AND execution."lease_expires_at" > clock_timestamp()
            )
            OR (
              execution."status" = 'FETCHING'
              AND execution."lease_expires_at" > clock_timestamp()
            )
          )
      ) + (
        SELECT COUNT(DISTINCT frequency_job."id")
        FROM "jobs" frequency_job
        JOIN "job_items" item
          ON item."job_id" = frequency_job."id"
         AND item."workspace_id" = frequency_job."workspace_id"
         AND item."project_id" = frequency_job."project_id"
        WHERE frequency_job."type" = 'FREQUENCY_COLLECTION'
          AND frequency_job."provider" = ${provider}
          AND (
            (
              frequency_job."status" IN (
                'RUNNING',
                'RETRY_SCHEDULED',
                'WAITING_RATE_LIMIT',
                'FAILED_RETRYABLE'
              )
              AND item."status" IN ('RUNNING', 'FAILED_RETRYABLE')
              AND item."provider_request_id" IS NOT NULL
            )
            OR (
              frequency_job."status" = 'ACTION_REQUIRED'
              AND item."provider_request_id" ~ '^submitting:'
            )
          )
      )
    )::bigint AS "activeTaskCount"
  `;
  const activeTaskCount = Number(rows[0]?.activeTaskCount ?? 0n);
  if (!Number.isSafeInteger(activeTaskCount) || activeTaskCount < 0) {
    throw new Error("Invalid active rank provider task count");
  }
  return Math.max(
    0,
    RANK_PROVIDER_ACTIVE_TASK_LIMIT - activeTaskCount
  );
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
    throw new Error("Invalid rank receipt hash");
  }
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function pendingLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return 20;
  return Math.min(value, 100);
}
