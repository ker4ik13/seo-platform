import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  RankCheckFinalStatus,
  RankJobFailureCode,
  InternalRankManifestChunk
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { Prisma } from "../generated/prisma/client.js";
import type {
  Job,
  RankConnectorExecution,
  RankJobRun
} from "../generated/prisma/client.js";
import { databaseClock } from "../database/database-clock.js";
import { PrismaService } from "../database/prisma.service.js";
import { safeErrorSummary } from "../runtime-safe-error.js";
import { connectorRuntimeLaneCount } from "../queue/connector-runtime-dispatch.js";
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
  rankJobFailureJson,
  rankJobResultJson
} from "./rank-job-record.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const RANK_PROVIDER_ACTIVE_TASK_LIMIT = 5;
const RANK_GRANT_WINDOW_SECONDS = 30;
const RANK_UNUSED_AUTHORIZATION_RETRY_DELAY_MS = 60_000;
const RANK_GRANT_BATCH_CONCURRENCY = 16;
// A 30-second grant leaves only five seconds before a 25-second submit lease
// becomes unclaimable. Never build a large expiring backlog for one Job.
const XMLSTOCK_UNSUBMITTED_GRANT_WINDOW_PER_JOB = 8;

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
          WHERE item."workspace_id" = j."workspace_id"
            AND item."project_id" = j."project_id"
            AND item."job_id" = j."id"
            AND item."status" = 'QUEUED'
        )
      ORDER BY
        j."updated_at" ASC,
        (
          j."progress_current"::numeric /
          GREATEST(j."progress_total"::numeric, 1)
        ) ASC,
        j."priority" ASC,
        j."created_at" ASC,
        j."id" ASC
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

    let pendingItems = false;
    for (let offset = 0; offset < dispatchable.itemIds.length; offset += 64) {
      const batch = dispatchable.itemIds.slice(offset, offset + 64);
      const startedAt = Date.now();
      let ready = 0;
      let prefetched: ReadonlyMap<string, InternalRankManifestChunk> = new Map();
      try {
        prefetched = await this.grants.prefetchForItems(batch);
      } catch (error) {
        this.logger.warn(`Rank manifest batch read unavailable: ${safeErrorSummary(error)}`);
      }
      // Grant requests are idempotent per item. Keep only a small window in
      // flight so one slow issuer round trip does not serialize a whole Job.
      for (let index = 0; index < batch.length; index += RANK_GRANT_BATCH_CONCURRENCY) {
        const group = batch.slice(index, index + RANK_GRANT_BATCH_CONCURRENCY);
        const outcomes = await Promise.allSettled(group.map((itemId) =>
          this.grants.issueForItem(itemId, `rank-grant-${itemId}`, prefetched.get(itemId))
        ));
        let terminalFailure: RankJobFailureCode | undefined;
        let retryableFailure = false;
        let disabled = false;
        for (const [position, outcome] of outcomes.entries()) {
          const itemId = group[position]!;
          if (outcome.status === "fulfilled") {
            if (outcome.value.status === "CONSUMED") ready++;
            else if (outcome.value.status === "DENIED" || outcome.value.status === "REJECTED_LOCAL") {
              terminalFailure = "EXECUTION_GRANT_DENIED";
            } else pendingItems = true;
            continue;
          }
          const error: unknown = outcome.reason;
          if (error instanceof RankExecutionGrantAttemptError) {
            const payload = JSON.stringify({
              event: "rank_execution_grant_failed",
              jobId: dispatchable.jobId,
              itemId,
              code: error.code,
              retryable: error.retryable,
              detail: error.detail ?? "unspecified"
            });
            if (error.retryable) {
              this.logger.warn(payload);
            } else {
              this.logger.error(payload);
            }
          } else {
            this.logger.error(
              JSON.stringify({
                event: "rank_execution_dispatch_failed",
                jobId: dispatchable.jobId,
                itemId,
                error: safeErrorSummary(error)
              })
            );
          }
          if (error instanceof RankExecutionGrantAttemptError && error.code === "SUBMIT_DISABLED") disabled = true;
          else if (error instanceof RankExecutionGrantAttemptError && error.retryable) retryableFailure = true;
          else terminalFailure ??= dispatchFailureCode(error);
        }
        if (terminalFailure) {
          await this.finishFailure(dispatchable.jobId, terminalFailure);
          return "FAILED";
        }
        if (disabled) return "DISABLED";
        if (retryableFailure) return "RETRY_PENDING";
      }
      if (ready > 0) this.logger.log(JSON.stringify({
        event: "rank_grant_batch_ready", jobId: dispatchable.jobId,
        ready, attempted: batch.length, elapsedMs: Date.now() - startedAt
      }));
    }
    return pendingItems ? "RETRY_PENDING" : "READY_TO_SUBMIT";
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
          const now = await databaseClock(
            transaction,
            "Unable to read Jobs database clock"
          );
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
              startedAt: now,
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
        const provider = job.provider;
        const itemGraph = await transaction.$queryRaw<readonly [{
          readonly itemCount: bigint;
          readonly minimumSequence: number | null;
          readonly maximumSequence: number | null;
        }]>(Prisma.sql`
          SELECT
            COUNT(*)::bigint AS "itemCount",
            MIN(item."sequence")::integer AS "minimumSequence",
            MAX(item."sequence")::integer AS "maximumSequence"
          FROM "job_items" item
          WHERE item."workspace_id" = ${identity.workspaceId}::uuid
            AND item."project_id" = ${identity.projectId}::uuid
            AND item."job_id" = ${jobId}::uuid
        `);
        const itemCount = Number(itemGraph[0]?.itemCount ?? -1n);
        const invalid =
          !run ||
          (provider !== "ARSENKIN" && provider !== "XMLSTOCK") ||
          run.sealState !== "SEALED" ||
          run.finalizationStatus !== null ||
          run.manifestChunkCount === null ||
          !Number.isSafeInteger(itemCount) ||
          itemCount !== run.manifestChunkCount ||
          itemGraph[0]?.minimumSequence !== 0 ||
          itemGraph[0]?.maximumSequence !== itemCount - 1;
        if (invalid) {
          return { jobId, itemIds: [], invalid: true };
        }
        if (
          !run ||
          (provider !== "ARSENKIN" && provider !== "XMLSTOCK")
        ) {
          return { jobId, itemIds: [], invalid: true };
        }
        const command = storedRankManifestCommand(
          run.manifestCommand,
          run.manifestCommandHash,
          commandBinding(job)
        );
        const localConnectorLaneCount = connectorRuntimeLaneCount(
          this.config.connectorRuntime.rankConcurrency,
          this.config.connectorRuntime.shardCount
        );
        // Remote slots run POLL_WAIT provider HTTP; only central connector
        // lanes can turn a short-lived grant into a durable POLL_WAIT task.
        const connectorLaneCount = localConnectorLaneCount;
        const capacity = await rankExecutionDispatchCapacity(
          transaction,
          provider,
          jobId,
          connectorLaneCount,
          rankExecutionDispatchLimit(
            connectorLaneCount,
            this.config.rankPreparation.dispatchSeconds
          ),
          rankProviderActiveTaskLimit(
            provider,
            command.execution.providerMappingVersion
          )
        );
        const now = await databaseClock(
          transaction,
          "Unable to read rank dispatch clock"
        );
        if (capacity === 0) {
          return { jobId, itemIds: [], invalid: false };
        }
        const jobCapacity = Math.min(
          capacity,
          provider === "XMLSTOCK"
            ? XMLSTOCK_UNSUBMITTED_GRANT_WINDOW_PER_JOB
            : connectorLaneCount
        );
        const retryBefore = new Date(
          now.getTime() - RANK_UNUSED_AUTHORIZATION_RETRY_DELAY_MS
        );
        const candidates = await transaction.$queryRaw<
          readonly { readonly id: string }[]
        >(Prisma.sql`
          SELECT item."id"::text AS "id"
          FROM "job_items" item
          LEFT JOIN LATERAL (
            SELECT
              execution."id",
              execution."status",
              execution."authorization_expires_at",
              execution."submit_attempt_count",
              execution."submit_bytes_started_at",
              execution."provider_task_id"
            FROM "rank_connector_executions" execution
            WHERE execution."workspace_id" = item."workspace_id"
              AND execution."job_item_id" = item."id"
            ORDER BY
              execution."execution_attempt" DESC,
              execution."id" DESC
            LIMIT 1
          ) latest_execution ON true
          WHERE item."workspace_id" = ${identity.workspaceId}::uuid
            AND item."project_id" = ${identity.projectId}::uuid
            AND item."job_id" = ${jobId}::uuid
            AND item."status" = 'QUEUED'
            AND (
              latest_execution."id" IS NULL
              OR (
                latest_execution."status" IN ('READY_TO_SUBMIT', 'CLAIMED')
                AND latest_execution."authorization_expires_at" <=
                  ${retryBefore}
                AND latest_execution."submit_attempt_count" = 0
                AND latest_execution."submit_bytes_started_at" IS NULL
                AND latest_execution."provider_task_id" IS NULL
              )
            )
          ORDER BY item."sequence" ASC
          LIMIT ${jobCapacity}
        `);
        return {
          jobId,
          itemIds: candidates.map(({ id }) => id),
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
        const now = await databaseClock(transaction);
        const executions = latestConnectorExecutions(
          await transaction.rankConnectorExecution.findMany({
            where: {
              workspaceId: current.workspaceId,
              projectId: current.projectId,
              jobId
            },
            orderBy: [
              { jobItemId: "asc" },
              { executionAttempt: "desc" },
              { id: "desc" }
            ]
          })
        );
        if (
          executions.some(
            (execution) =>
              execution.status === "SUBMIT_OUTCOME_UNKNOWN" ||
              (![
                "PERSISTED",
                "FAILED_RETRYABLE",
                "FAILED_FINAL"
              ].includes(execution.status) &&
                !isExpiredUnusedAuthorization(execution, now))
          )
        ) {
          return undefined;
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
      run.manifestPairCount < 1 ||
      !run.manifestChunkCount ||
      run.manifestChunkCount < 1
    ) {
      throw new Error("Rank failure manifest is incomplete");
    }
    const command = storedRankManifestCommand(
      run.manifestCommand,
      run.manifestCommandHash,
      commandBinding(stored)
    );
    const persistedCount = Number(stored.progressCurrent);
    const pairCount = run.manifestPairCount;
    if (
      !Number.isSafeInteger(persistedCount) ||
      persistedCount < 0 ||
      persistedCount > pairCount
    ) {
      throw new Error("Rank failure progress is invalid");
    }
    const finalStatus = rankGrantFailureFinalStatus(
      persistedCount,
      pairCount
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
          status: finalStatus
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
      throw new Error("Unable to finalize rejected rank execution", {
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
        if (
          receipt.status !== finalStatus ||
          Number(receipt.pairCount) !== pairCount ||
          Number(receipt.persistedCount) !== persistedCount ||
          Number(receipt.missingCount) !== pairCount - persistedCount
        ) {
          throw new Error(
            "Rank failure finalization receipt does not match progress"
          );
        }
        const itemGraph = await transaction.$queryRaw<readonly [{
          readonly count: bigint;
          readonly minimumSequence: number | null;
          readonly maximumSequence: number | null;
        }]>(Prisma.sql`
          SELECT COUNT(*)::bigint AS "count",
            MIN(item."sequence")::integer AS "minimumSequence",
            MAX(item."sequence")::integer AS "maximumSequence"
          FROM "job_items" item
          WHERE item."workspace_id" = ${current.workspaceId}::uuid
            AND item."project_id" = ${receipt.projectId}::uuid
            AND item."job_id" = ${jobId}::uuid
        `);
        const itemCount = Number(itemGraph[0]?.count ?? -1n);
        if (
          itemCount !== current.rankRun.manifestChunkCount ||
          itemGraph[0]?.minimumSequence !== 0 ||
          itemGraph[0]?.maximumSequence !== itemCount - 1
        ) {
          throw new Error("Rank failure JobItem graph is invalid");
        }
        const changedItems = await transaction.$executeRaw(Prisma.sql`
          UPDATE "job_items" item
          SET "status" = CASE WHEN latest."status" = 'PERSISTED'
                THEN 'COMPLETED'::"JobItemStatus"
                ELSE 'FAILED_FINAL'::"JobItemStatus" END,
              "provider_request_id" = latest."providerTaskId",
              "output_reference" = CASE WHEN latest."status" = 'PERSISTED'
                THEN jsonb_build_object(
                  'schemaVersion', 'rank-job-item-output@1',
                  'manifestId', ${receipt.manifestId}::text,
                  'chunkIndex', item."sequence"
                ) ELSE NULL END,
              "actual_cost_micro" = 0,
              "error" = CASE WHEN latest."status" = 'PERSISTED'
                THEN NULL
                ELSE ${JSON.stringify(rankJobFailureJson(failureCode))}::jsonb
              END,
              "attempt" = COALESCE(latest."executionAttempt", 1),
              "retry_at" = NULL,
              "updated_at" = clock_timestamp()
          FROM (
            SELECT target."id", execution."status",
                   execution."provider_task_id" AS "providerTaskId",
                   execution."execution_attempt" AS "executionAttempt"
            FROM "job_items" target
            LEFT JOIN LATERAL (
              SELECT candidate."status", candidate."provider_task_id",
                     candidate."execution_attempt"
              FROM "rank_connector_executions" candidate
              WHERE candidate."workspace_id" = target."workspace_id"
                AND candidate."project_id" = target."project_id"
                AND candidate."job_id" = target."job_id"
                AND candidate."job_item_id" = target."id"
              ORDER BY candidate."execution_attempt" DESC,
                       candidate."id" DESC
              LIMIT 1
            ) execution ON TRUE
            WHERE target."workspace_id" = ${current.workspaceId}::uuid
              AND target."project_id" = ${receipt.projectId}::uuid
              AND target."job_id" = ${jobId}::uuid
          ) latest
          WHERE item."id" = latest."id"
            AND item."workspace_id" = ${current.workspaceId}::uuid
            AND item."project_id" = ${receipt.projectId}::uuid
            AND item."job_id" = ${jobId}::uuid
            AND item."status" = 'QUEUED'
        `);
        if (changedItems !== itemCount) {
          throw new Error("Rank failure JobItem finalization race");
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
            finalizationStatus: receipt.status,
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
            status:
              receipt.status === "FAILED"
                ? "FAILED_FINAL"
                : receipt.status,
            stage: "FINISHED",
            progressCurrent: BigInt(receipt.persistedCount),
            resultSummary: rankJobResultJson({
              pairCount: receipt.pairCount,
              persistedCount: receipt.persistedCount,
              foundCount: receipt.foundCount,
              notFoundCount: receipt.notFoundCount,
              failedCount: receipt.missingCount,
              submitOutcomeUnknownCount: "0"
            }),
            errorSummary:
              receipt.status === "FAILED"
                ? rankJobFailureJson(failureCode)
                : Prisma.DbNull,
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

function latestConnectorExecutions(
  executions: readonly RankConnectorExecution[]
): readonly RankConnectorExecution[] {
  const latest = new Map<string, RankConnectorExecution>();
  for (const execution of executions) {
    if (!latest.has(execution.jobItemId)) {
      latest.set(execution.jobItemId, execution);
    }
  }
  return [...latest.values()];
}

export function rankGrantFailureFinalStatus(
  persistedCount: number,
  pairCount: number
): Exclude<RankCheckFinalStatus, "CANCELLED" | "ACTION_REQUIRED"> {
  if (
    !Number.isSafeInteger(persistedCount) ||
    !Number.isSafeInteger(pairCount) ||
    pairCount < 1 ||
    persistedCount < 0 ||
    persistedCount > pairCount
  ) {
    throw new TypeError("Invalid rejected rank progress");
  }
  return persistedCount === pairCount
    ? "COMPLETED"
    : persistedCount > 0
      ? "PARTIALLY_COMPLETED"
      : "FAILED";
}

function isExpiredUnusedAuthorization(execution: {
  readonly status: string;
  readonly authorizationExpiresAt: Date;
  readonly submitAttemptCount: number;
  readonly submitBytesStartedAt: Date | null;
  readonly providerTaskId: string | null;
}, now: Date): boolean {
  return (
    (execution.status === "READY_TO_SUBMIT" ||
      execution.status === "CLAIMED") &&
    execution.authorizationExpiresAt.getTime() <= now.getTime() &&
    execution.submitAttemptCount === 0 &&
    execution.submitBytesStartedAt === null &&
    execution.providerTaskId === null
  );
}

function dispatchFailureCode(error: unknown): RankJobFailureCode {
  if (!(error instanceof RankExecutionGrantAttemptError)) {
    return "INTERNAL_ERROR";
  }
  if (error.code === "DECISION_REJECTED") {
    return "EXECUTION_GRANT_DENIED";
  }
  if (
    error.code === "LOCAL_STATE_INVALID" &&
    error.detail === "execution_projection_changed"
  ) {
    return "ESTIMATE_STALE";
  }
  return "INTERNAL_ERROR";
}

async function rankExecutionDispatchCapacity(
  transaction: Prisma.TransactionClient,
  provider: "ARSENKIN" | "XMLSTOCK",
  jobId: string,
  connectorLaneCount: number,
  dispatchLimit: number,
  activeTaskLimit: number | undefined
): Promise<number> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        'seo-platform:rank-dispatch:global'::text,
        0
      )
    )
  `;
  // XMLStock grants live for 30 seconds and a submit claim needs 25 seconds.
  // Poll-waiting pages have durable state; only unsubmitted grants occupy
  // the short per-Job admission window below.
  const grantWindow = provider === "XMLSTOCK"
    ? Math.min(dispatchLimit, connectorLaneCount)
    : dispatchLimit;
  let activeJobCount = 1;
  if (provider === "XMLSTOCK") {
    const jobs = await transaction.$queryRaw<
      readonly { readonly activeJobCount: bigint }[]
    >`
      SELECT COUNT(*)::bigint AS "activeJobCount"
      FROM "jobs" job
      JOIN "rank_job_runs" run
        ON run."workspace_id" = job."workspace_id"
       AND run."project_id" = job."project_id"
       AND run."job_id" = job."id"
      WHERE job."type" = 'MANUAL_RANK_CHECK'
        AND job."provider" = 'XMLSTOCK'
        AND job."status" IN ('QUEUED', 'RUNNING')
        AND job."stage" IN ('WAITING_FOR_QUEUE', 'WAITING_EXECUTION_GRANT')
        AND job."cancel_requested_at" IS NULL
        AND run."seal_state" = 'SEALED'
        AND run."finalization_status" IS NULL
        AND (job."progress_total" IS NULL
          OR job."progress_current" < job."progress_total")
    `;
    activeJobCount = Math.max(1, Number(jobs[0]?.activeJobCount ?? 0n));
  }
  const hardLimit = provider === "XMLSTOCK"
    ? rankDispatchHardLimit(grantWindow)
    : grantWindow;
  const candidateLimit = grantWindow * 64;
  if (!Number.isSafeInteger(candidateLimit)) {
    throw new TypeError("Rank dispatch candidate limit overflow");
  }
  const globalRows = await transaction.$queryRaw<
    readonly {
      readonly activeConnectorCount: bigint;
      readonly jobConnectorCount: bigint;
    }[]
  >(Prisma.sql`
    WITH ready_execution AS MATERIALIZED (
      (
        SELECT
          execution."id",
          execution."workspace_id",
          execution."project_id",
          execution."job_id",
          execution."job_version"
        FROM "rank_connector_executions" execution
        WHERE execution."status" = 'READY_TO_SUBMIT'
          AND execution."authorization_expires_at" > statement_timestamp()
        LIMIT ${candidateLimit}
      )
      UNION ALL
      (
        SELECT
          execution."id",
          execution."workspace_id",
          execution."project_id",
          execution."job_id",
          execution."job_version"
        FROM "rank_connector_executions" execution
        WHERE execution."status" = 'CLAIMED'
          AND execution."authorization_expires_at" > statement_timestamp()
        LIMIT ${candidateLimit}
      )
      UNION ALL
      (
        SELECT
          execution."id",
          execution."workspace_id",
          execution."project_id",
          execution."job_id",
          execution."job_version"
        FROM "rank_connector_executions" execution
        WHERE execution."status" = 'SUBMITTING'
        LIMIT ${candidateLimit}
      )
      UNION ALL
      (
        SELECT
          execution."id",
          execution."workspace_id",
          execution."project_id",
          execution."job_id",
          execution."job_version"
        FROM "rank_connector_executions" execution
        WHERE execution."status" = 'POLL_WAIT'
          AND ${provider}::text = 'ARSENKIN'
          AND execution."next_action_at" <= statement_timestamp()
        LIMIT ${candidateLimit}
      )
      UNION ALL
      (
        SELECT
          execution."id",
          execution."workspace_id",
          execution."project_id",
          execution."job_id",
          execution."job_version"
        FROM "rank_connector_executions" execution
        WHERE execution."status" = 'FETCHING'
          AND ${provider}::text = 'ARSENKIN'
        LIMIT ${candidateLimit}
      )
    )
    SELECT COUNT(*)::bigint AS "activeConnectorCount",
           (
             SELECT COUNT(*)::bigint
             FROM ready_execution own_execution
             WHERE own_execution."job_id" = ${jobId}::uuid
           ) AS "jobConnectorCount"
    FROM (
      SELECT ready_execution."id", ready_execution."job_id"
      FROM ready_execution
      JOIN "jobs" rank_job
        ON rank_job."workspace_id" = ready_execution."workspace_id"
       AND rank_job."project_id" = ready_execution."project_id"
       AND rank_job."id" = ready_execution."job_id"
      WHERE rank_job."type" = 'MANUAL_RANK_CHECK'
        AND rank_job."status" = 'RUNNING'
        AND rank_job."stage" = 'WAITING_EXECUTION_GRANT'
        AND rank_job."cancel_requested_at" IS NULL
        AND rank_job."version" = ready_execution."job_version"
      LIMIT ${hardLimit}
    ) active_execution
  `);
  const activeConnectorCount = Number(
    globalRows[0]?.activeConnectorCount ?? 0n
  );
  const jobConnectorCount = Number(globalRows[0]?.jobConnectorCount ?? 0n);
  let activeProviderTaskCount = 0;
  if (activeTaskLimit !== undefined) {
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
    activeProviderTaskCount = Number(rows[0]?.activeTaskCount ?? 0n);
  }
  if (provider === "XMLSTOCK") {
    return fairXmlStockRankDispatchCapacity(
      grantWindow,
      connectorLaneCount,
      activeJobCount,
      activeConnectorCount,
      jobConnectorCount
    );
  }
  return availableRankExecutionDispatchCapacity(
    dispatchLimit, activeConnectorCount, activeTaskLimit, activeProviderTaskCount
  );
}

function rankDispatchFairBootstrap(
  connectorLaneCount: number,
  activeJobCount: number
): number {
  return Math.max(
    1,
    Math.min(connectorLaneCount, Math.ceil(2 * connectorLaneCount / activeJobCount))
  );
}

function rankDispatchHardLimit(dispatchLimit: number): number {
  const hardLimit = dispatchLimit + Math.floor(dispatchLimit / 4);
  if (!Number.isSafeInteger(hardLimit)) {
    throw new TypeError("Rank dispatch recovery limit overflow");
  }
  return hardLimit;
}

/** A bounded recovery share prevents an old Job's due pages from starving peers. */
export function fairXmlStockRankDispatchCapacity(
  dispatchLimit: number,
  connectorLaneCount: number,
  activeJobCount: number,
  activeConnectorCount: number,
  jobConnectorCount: number
): number {
  if (
    ![dispatchLimit, connectorLaneCount, activeJobCount,
      activeConnectorCount, jobConnectorCount].every(Number.isSafeInteger) ||
    dispatchLimit < 1 || connectorLaneCount < 1 || activeJobCount < 1 ||
    activeConnectorCount < 0 || jobConnectorCount < 0
  ) {
    throw new TypeError("Invalid fair rank dispatch capacity");
  }
  const fairShare = Math.max(1, Math.floor(dispatchLimit / activeJobCount));
  const jobWindow = Math.min(
    connectorLaneCount,
    XMLSTOCK_UNSUBMITTED_GRANT_WINDOW_PER_JOB
  );
  const jobHeadroom = Math.max(
    0,
    Math.min(jobWindow, fairShare) - jobConnectorCount
  );
  const normalCapacity = Math.max(0, dispatchLimit - activeConnectorCount);
  if (normalCapacity > 0) {
    return Math.min(jobWindow, normalCapacity, jobHeadroom);
  }
  const recoveryTarget = dispatchLimit <= connectorLaneCount
    ? fairShare
    : Math.min(
        fairShare,
        rankDispatchFairBootstrap(connectorLaneCount, activeJobCount)
      );
  const recoveryHeadroom = Math.max(
    0, Math.min(jobWindow, recoveryTarget) - jobConnectorCount
  );
  return Math.min(
    jobHeadroom, recoveryHeadroom,
    Math.max(0, rankDispatchHardLimit(dispatchLimit) - activeConnectorCount)
  );
}

export function availableRankExecutionDispatchCapacity(
  dispatchLimit: number,
  activeConnectorCount: number,
  activeProviderTaskLimit: number | undefined,
  activeProviderTaskCount: number
): number {
  if (
    !Number.isSafeInteger(dispatchLimit) ||
    dispatchLimit < 1 ||
    !Number.isSafeInteger(activeConnectorCount) ||
    activeConnectorCount < 0 ||
    (activeProviderTaskLimit !== undefined &&
      (!Number.isSafeInteger(activeProviderTaskLimit) ||
        activeProviderTaskLimit < 1)) ||
    !Number.isSafeInteger(activeProviderTaskCount) ||
    activeProviderTaskCount < 0
  ) {
    throw new TypeError("Invalid rank execution dispatch capacity");
  }
  const connectorCapacity = Math.max(
    0,
    dispatchLimit - activeConnectorCount
  );
  const providerCapacity = activeProviderTaskLimit === undefined
    ? dispatchLimit
    : Math.max(0, activeProviderTaskLimit - activeProviderTaskCount);
  return Math.min(connectorCapacity, providerCapacity);
}

export function rankExecutionDispatchLimit(
  connectorLaneCount: number,
  dispatchSeconds: number
): number {
  if (
    !Number.isSafeInteger(connectorLaneCount) ||
    connectorLaneCount < 1 ||
    !Number.isSafeInteger(dispatchSeconds) ||
    dispatchSeconds < 1
  ) {
    throw new TypeError("Invalid rank execution dispatch limit");
  }
  const limit =
    connectorLaneCount * Math.min(dispatchSeconds, RANK_GRANT_WINDOW_SECONDS);
  if (!Number.isSafeInteger(limit)) {
    throw new TypeError("Rank execution dispatch limit overflow");
  }
  return limit;
}

/**
 * Arsenkin has one shared provider-task lifecycle window. XMLStock is instead
 * bounded by the global connector-lane budget above and per credential/product
 * by the distributed HTTP quota limiter; applying the Arsenkin lifecycle
 * window here would serialize unrelated XMLStock projects.
 */
export function rankProviderActiveTaskLimit(
  provider: "ARSENKIN" | "XMLSTOCK",
  _providerMappingVersion: string
): number | undefined {
  return provider === "XMLSTOCK"
    ? undefined
    : RANK_PROVIDER_ACTIVE_TASK_LIMIT;
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
