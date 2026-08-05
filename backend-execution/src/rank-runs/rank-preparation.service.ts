import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  legacyRankManifestChunkSize,
  legacyRankProviderKeywordLimit,
  rankManifestSingleTaskChunkSize,
  rankProviderKeywordLimit,
  xmlStockRankManifestChunkSize,
  type InternalFinalizeRankCheckInput,
  type InternalRankManifestSeal,
  type RankJobFailureCode,
  type RankJobSummary
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { Prisma } from "../generated/prisma/client.js";
import type { Job } from "../generated/prisma/client.js";
import { databaseClock } from "../database/database-clock.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  RankManifestClient,
  RankManifestClientError
} from "../seo-data/rank-manifest.client.js";
import {
  storedRankManifestCommand,
  type RankManifestCommandBinding
} from "./rank-manifest-command.js";
import { lockRankJobGraph } from "./rank-job-lock.js";
import {
  MANUAL_RANK_CHECK_JOB_TYPE,
  rankJobFailureJson,
  rankJobResultJson,
  toRankJobSummary,
  type StoredRankJob
} from "./rank-job-record.js";

const LEASE_OWNER_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

interface ClaimedRankPreparation {
  readonly job: StoredRankJob;
  readonly claimed: boolean;
  readonly exhausted: boolean;
}

@Injectable()
export class RankPreparationService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly manifests: RankManifestClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async process(
    jobId: string,
    leaseOwner: string
  ): Promise<RankJobSummary> {
    assertLeaseOwner(leaseOwner);
    const claim = await this.claim(jobId, leaseOwner);
    if (!claim.claimed) return toRankJobSummary(claim.job);
    const claimed = claim.job;
    if (claim.exhausted) {
      return this.finishActionRequired(claimed, leaseOwner);
    }
    const run = requiredRun(claimed);

    if (run.sealState === "SEALED") {
      return this.finalizeCancellation(claimed, leaseOwner);
    }

    let command: ReturnType<typeof storedRankManifestCommand>;
    try {
      command = storedRankManifestCommand(
        run.manifestCommand,
        run.manifestCommandHash,
        commandBinding(claimed)
      );
    } catch {
      return this.finishActionRequired(claimed, leaseOwner);
    }

    let seal: InternalRankManifestSeal;
    try {
      seal = await this.manifests.seal(command);
    } catch (error) {
      if (error instanceof RankManifestClientError && !error.retryable) {
        return provesManifestWasNotSealed(error.code)
          ? this.finishWithoutSeal(
              claimed,
              leaseOwner,
              sealFailureCode(error.code)
            )
          : this.finishActionRequired(claimed, leaseOwner);
      }
      return this.releaseForRetry(claimed, leaseOwner);
    }

    const persisted = await this.persistSeal(
      claimed,
      leaseOwner,
      seal
    );
    if (persisted.status === "CANCEL_REQUESTED") {
      return this.finalizeCancellation(persisted, leaseOwner);
    }
    return toRankJobSummary(persisted);
  }

  public async pendingPreparationIds(
    limit = 100
  ): Promise<readonly string[]> {
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
            j."status" = 'PREPARING'
            AND r."seal_state" IN ('PENDING', 'OUTCOME_UNKNOWN')
          )
          OR
          (
            j."status" = 'CANCEL_REQUESTED'
            AND r."seal_state" IN ('OUTCOME_UNKNOWN', 'SEALED')
          )
        )
        AND (
          j."lease_expires_at" IS NULL
          OR j."lease_expires_at" <= clock_timestamp()
        )
        AND (
          j."retry_at" IS NULL
          OR j."retry_at" <= clock_timestamp()
        )
      ORDER BY j."priority" ASC, j."created_at" ASC, j."id" ASC
      LIMIT ${boundedLimit}
    `;
    return rows.map(({ id }) => id);
  }

  private async claim(
    jobId: string,
    leaseOwner: string
  ): Promise<ClaimedRankPreparation> {
    return this.prisma.$transaction(
      async (transaction) => {
        await lockRankJobGraph(transaction, jobId);
        const current = await findRankJob(transaction, jobId);
        if (!current) throw new NotFoundException("Manual rank Job not found");
        if (!isPreparationCandidate(current)) {
          return { job: current, claimed: false, exhausted: false };
        }
        const now = await databaseClock(transaction);
        if (
          (current.retryAt && current.retryAt > now) ||
          (current.leaseExpiresAt &&
            current.leaseExpiresAt > now)
        ) {
          return { job: current, claimed: false, exhausted: false };
        }
        const exhausted = current.attempt >= current.maxAttempts;
        const leaseExpiresAt = new Date(
          now.getTime() +
            this.config.rankPreparation.leaseSeconds * 1_000
        );
        const changed = await transaction.job.updateMany({
          where: {
            id: current.id,
            type: MANUAL_RANK_CHECK_JOB_TYPE,
            status: current.status,
            version: current.version,
            OR: [
              { leaseExpiresAt: null },
              { leaseExpiresAt: { lte: now } }
            ],
            AND: [
              {
                OR: [
                  { retryAt: null },
                  { retryAt: { lte: now } }
                ]
              }
            ]
          },
          data: {
            leaseOwner,
            leaseExpiresAt,
            retryAt: null,
            ...(exhausted ? {} : { attempt: { increment: 1 } }),
            version: { increment: 1 }
          }
        });
        if (changed.count !== 1) {
          return {
            job: await requiredRankJob(transaction, current.id),
            claimed: false,
            exhausted: false
          };
        }

        const run = requiredRun(current);
        if (
          !exhausted &&
          (run.sealState === "PENDING" ||
            run.sealState === "OUTCOME_UNKNOWN")
        ) {
          const runChanged = await transaction.rankJobRun.updateMany({
            where: {
              jobId: current.id,
              sealState: run.sealState,
              sealAttemptCount: run.sealAttemptCount
            },
            data: {
              sealState: "OUTCOME_UNKNOWN",
              sealAttemptCount: { increment: 1 },
              lastSealAttemptAt: now
            }
          });
          if (runChanged.count !== 1) {
            throw new Error("Rank manifest claim optimistic lock was lost");
          }
        }
        return {
          job: await requiredRankJob(transaction, current.id),
          claimed: true,
          exhausted
        };
      },
      { isolationLevel: "ReadCommitted" }
    );
  }

  private async persistSeal(
    claimed: StoredRankJob,
    leaseOwner: string,
    seal: InternalRankManifestSeal
  ): Promise<StoredRankJob> {
    const run = requiredRun(claimed);
    return this.prisma.$transaction(
      async (transaction) => {
        const current = await requiredClaimedJob(
          transaction,
          claimed,
          leaseOwner
        );
        const currentRun = requiredRun(current);
        if (
          currentRun.sealState !== "OUTCOME_UNKNOWN" ||
          currentRun.sealAttemptCount !== run.sealAttemptCount ||
          seal.id === "" ||
          seal.workspaceId !== current.workspaceId ||
          seal.projectId !== current.projectId ||
          seal.jobId !== current.id ||
          seal.estimateId !== currentRun.estimateId ||
          seal.trackingContextId !== currentRun.trackingContextId ||
          Number(seal.pairCount) !== Number(current.progressTotal) ||
          !validManifestSealShape(seal)
        ) {
          throw new Error("Rank manifest receipt does not match claimed Job");
        }
        const runChanged = await transaction.rankJobRun.updateMany({
          where: {
            jobId: current.id,
            sealState: "OUTCOME_UNKNOWN",
            sealAttemptCount: currentRun.sealAttemptCount
          },
          data: {
            sealState: "SEALED",
            manifestId: seal.id,
            manifestHashSchema: seal.hashSchemaVersion,
            manifestHash: hashBytes(seal.manifestHash.value),
            manifestDeduplicationHash: hashBytes(
              seal.deduplicationHash.value
            ),
            manifestPairCount: Number(seal.pairCount),
            manifestChunkCount: Number(seal.chunkCount),
            manifestChunkSize: Number(seal.chunkSize),
            manifestSealedAt: new Date(seal.sealedAt)
          }
        });
        if (runChanged.count !== 1) {
          throw new Error("Rank manifest receipt optimistic lock was lost");
        }

        if (current.status === "CANCEL_REQUESTED") {
          await updateClaimedJob(transaction, current, leaseOwner, {
            version: { increment: 1 }
          });
          return requiredRankJob(transaction, current.id);
        }
        if (current.status !== "PREPARING") {
          throw new Error("Rank manifest was sealed for an invalid Job state");
        }
        await transaction.jobItem.createMany({
          data: Array.from(
            { length: Number(seal.chunkCount) },
            (_, chunkIndex) => ({
              workspaceId: current.workspaceId,
              projectId: current.projectId,
              jobId: current.id,
              sequence: chunkIndex,
              status: "QUEUED" as const,
              inputReference: {
                schemaVersion: "rank-job-item@1",
                manifestId: seal.id,
                chunkIndex
              }
            })
          )
        });
        const queuedAt = new Date(seal.sealedAt);
        await updateClaimedJob(transaction, current, leaseOwner, {
          status: "QUEUED",
          stage: "WAITING_FOR_QUEUE",
          queuedAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          retryAt: null,
          version: { increment: 1 }
        });
        return requiredRankJob(transaction, current.id);
      },
      { isolationLevel: "ReadCommitted" }
    );
  }

  private async finishWithoutSeal(
    claimed: StoredRankJob,
    leaseOwner: string,
    failureCode: RankJobFailureCode
  ): Promise<RankJobSummary> {
    const stored = await this.prisma.$transaction(
      async (transaction) => {
        const current = await requiredClaimedJob(
          transaction,
          claimed,
          leaseOwner
        );
        const run = requiredRun(current);
        if (run.sealState !== "OUTCOME_UNKNOWN") {
          throw new Error("Rank manifest outcome is not unresolved");
        }
        const now = await databaseClock(transaction);
        const runChanged = await transaction.rankJobRun.updateMany({
          where: {
            jobId: current.id,
            sealState: "OUTCOME_UNKNOWN",
            sealAttemptCount: run.sealAttemptCount
          },
          data: { sealState: "NOT_SEALED" }
        });
        if (runChanged.count !== 1) {
          throw new Error("Rank manifest terminal outcome race");
        }
        const cancelled = current.status === "CANCEL_REQUESTED";
        await updateClaimedJob(transaction, current, leaseOwner, {
          status: cancelled
            ? "CANCELLED"
            : failureCode === "ESTIMATE_EXPIRED"
              ? "EXPIRED"
              : "FAILED_FINAL",
          stage: "FINISHED",
          errorSummary: cancelled
            ? Prisma.DbNull
            : rankJobFailureJson(failureCode),
          finishedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          retryAt: null,
          version: { increment: 1 }
        });
        return requiredRankJob(transaction, current.id);
      },
      { isolationLevel: "ReadCommitted" }
    );
    return toRankJobSummary(stored);
  }

  private async releaseForRetry(
    claimed: StoredRankJob,
    leaseOwner: string
  ): Promise<RankJobSummary> {
    if (claimed.attempt >= claimed.maxAttempts) {
      return this.finishActionRequired(claimed, leaseOwner);
    }
    const delayMilliseconds = rankPreparationRetryDelayMilliseconds(
      claimed.id,
      claimed.attempt
    );
    await this.prisma.$transaction(async (transaction) => {
      const current = await requiredClaimedJob(
        transaction,
        claimed,
        leaseOwner
      );
      const now = await databaseClock(transaction);
      if (
        !current.leaseExpiresAt ||
        current.leaseExpiresAt <= now
      ) {
        return;
      }
      await updateClaimedJob(transaction, current, leaseOwner, {
        leaseOwner: null,
        leaseExpiresAt: null,
        retryAt: new Date(
          now.getTime() + delayMilliseconds
        ),
        version: { increment: 1 }
      });
    });
    const current = await findRankJob(this.prisma, claimed.id);
    if (!current) throw new NotFoundException("Manual rank Job not found");
    return toRankJobSummary(current);
  }

  private async finishActionRequired(
    claimed: StoredRankJob,
    leaseOwner: string
  ): Promise<RankJobSummary> {
    const stored = await this.prisma.$transaction(
      async (transaction) => {
        const current = await requiredClaimedJob(
          transaction,
          claimed,
          leaseOwner
        );
        const now = await databaseClock(
          transaction,
          "Unable to finish unresolved rank preparation"
        );
        if (current.progressTotal === null) {
          throw new Error("Unable to finish unresolved rank preparation");
        }
        const pairCount = current.progressTotal.toString();
        await updateClaimedJob(transaction, current, leaseOwner, {
          status: "ACTION_REQUIRED",
          stage: "SUBMIT_OUTCOME_UNKNOWN",
          progressCurrent: 0n,
          resultSummary: rankJobResultJson({
            pairCount,
            persistedCount: "0",
            foundCount: "0",
            notFoundCount: "0",
            failedCount: "0",
            submitOutcomeUnknownCount: pairCount
          }),
          errorSummary: rankJobFailureJson("SUBMIT_OUTCOME_UNKNOWN"),
          finishedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          retryAt: null,
          version: { increment: 1 }
        });
        return requiredRankJob(transaction, current.id);
      },
      { isolationLevel: "ReadCommitted" }
    );
    return toRankJobSummary(stored);
  }

  private async finalizeCancellation(
    claimed: StoredRankJob,
    leaseOwner: string
  ): Promise<RankJobSummary> {
    const run = requiredRun(claimed);
    if (
      claimed.status !== "CANCEL_REQUESTED" ||
      run.sealState !== "SEALED" ||
      !run.manifestId ||
      !run.manifestPairCount ||
      !run.cancelRequestedBy
    ) {
      return this.finishActionRequired(claimed, leaseOwner);
    }
    let command: ReturnType<typeof storedRankManifestCommand>;
    try {
      command = storedRankManifestCommand(
        run.manifestCommand,
        run.manifestCommandHash,
        commandBinding(claimed)
      );
    } catch {
      return this.finishActionRequired(claimed, leaseOwner);
    }
    const input: InternalFinalizeRankCheckInput = {
      schemaVersion: "rank-finalize@1",
      workspaceId: claimed.workspaceId,
      projectId: claimed.projectId as string,
      actorId: run.cancelRequestedBy,
      jobId: claimed.id,
      manifestId: run.manifestId,
      status: "CANCELLED"
    };
    let receipt: Awaited<ReturnType<RankManifestClient["finalize"]>>;
    try {
      receipt = await this.manifests.finalize(input, {
        trackingContextId: run.trackingContextId,
        configurationVersion: command.estimate.configurationVersion,
        pairCount: run.manifestPairCount
      });
    } catch (error) {
      return error instanceof RankManifestClientError && error.retryable
        ? this.releaseForRetry(claimed, leaseOwner)
        : this.finishActionRequired(claimed, leaseOwner);
    }

    const stored = await this.prisma.$transaction(
      async (transaction) => {
        const current = await requiredClaimedJob(
          transaction,
          claimed,
          leaseOwner
        );
        const currentRun = requiredRun(current);
        if (
          current.status !== "CANCEL_REQUESTED" ||
          currentRun.sealState !== "SEALED" ||
          currentRun.manifestId !== receipt.manifestId
        ) {
          throw new Error("Rank finalization receipt does not match Job");
        }
        const runChanged = await transaction.rankJobRun.updateMany({
          where: {
            jobId: current.id,
            sealState: "SEALED",
            manifestId: receipt.manifestId
          },
          data: {
            sealState: "FINALIZED",
            finalizationStatus: "CANCELLED",
            finalizationRequestHash: hashBytes(
              receipt.requestHash.value
            ),
            finalizedAt: new Date(receipt.finalizedAt)
          }
        });
        if (runChanged.count !== 1) {
          throw new Error("Rank finalization optimistic lock was lost");
        }
        await updateClaimedJob(transaction, current, leaseOwner, {
          status: "CANCELLED",
          stage: "FINISHED",
          progressCurrent: BigInt(receipt.persistedCount),
          resultSummary: Prisma.DbNull,
          errorSummary: Prisma.DbNull,
          finishedAt: new Date(receipt.finalizedAt),
          leaseOwner: null,
          leaseExpiresAt: null,
          retryAt: null,
          version: { increment: 1 }
        });
        return requiredRankJob(transaction, current.id);
      },
      { isolationLevel: "ReadCommitted" }
    );
    return toRankJobSummary(stored);
  }
}

export function rankPreparationRetryDelayMilliseconds(
  jobId: string,
  attempt: number
): number {
  const boundedAttempt = Math.min(Math.max(attempt, 1), 1_000);
  const base = Math.min(
    60_000,
    2 ** Math.min(boundedAttempt, 5) * 5_000
  );
  const window = Math.min(5_000, Math.floor(base / 5));
  const suffix = jobId.replaceAll("-", "").slice(-8);
  const jobSeed = Number.parseInt(suffix, 16);
  if (!Number.isFinite(jobSeed)) {
    throw new Error("Invalid manual rank Job identifier");
  }
  const seed =
    (jobSeed ^ Math.imul(boundedAttempt, 0x9e3779b1)) >>> 0;
  const offset = (seed % (window * 2 + 1)) - window;
  return Math.max(5_000, Math.min(60_000, base + offset));
}

function isPreparationCandidate(job: StoredRankJob): boolean {
  const state = requiredRun(job).sealState;
  return (
    (job.status === "PREPARING" &&
      (state === "PENDING" || state === "OUTCOME_UNKNOWN")) ||
    (job.status === "CANCEL_REQUESTED" &&
      (state === "OUTCOME_UNKNOWN" || state === "SEALED"))
  );
}

function sealFailureCode(
  code: RankManifestClientError["code"]
): RankJobFailureCode {
  if (
    code === "ESTIMATE_EXPIRED" ||
    code === "ESTIMATE_STALE" ||
    code === "EQUIVALENT_RUN_ACTIVE"
  ) {
    return code;
  }
  return "INTERNAL_ERROR";
}

function provesManifestWasNotSealed(
  code: RankManifestClientError["code"]
): boolean {
  return (
    code === "ESTIMATE_EXPIRED" ||
    code === "ESTIMATE_STALE" ||
    code === "EQUIVALENT_RUN_ACTIVE"
  );
}

function requiredRun(
  job: StoredRankJob
): NonNullable<StoredRankJob["rankRun"]> {
  if (!job.rankRun) throw new Error("Manual rank Job has no run sidecar");
  return job.rankRun;
}

function commandBinding(job: StoredRankJob): RankManifestCommandBinding {
  const run = requiredRun(job);
  if (
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

function findRankJob(
  transaction: Pick<Prisma.TransactionClient, "job">,
  jobId: string
): Promise<StoredRankJob | null> {
  return transaction.job.findFirst({
    where: { id: jobId, type: MANUAL_RANK_CHECK_JOB_TYPE },
    include: { rankRun: true }
  });
}

async function requiredRankJob(
  transaction: Pick<Prisma.TransactionClient, "job">,
  jobId: string
): Promise<StoredRankJob> {
  const job = await findRankJob(transaction, jobId);
  if (!job) throw new NotFoundException("Manual rank Job not found");
  return job;
}

async function requiredClaimedJob(
  transaction: Prisma.TransactionClient,
  claimed: StoredRankJob,
  leaseOwner: string
): Promise<StoredRankJob> {
  await lockRankJobGraph(transaction, claimed.id);
  const current = await requiredRankJob(transaction, claimed.id);
  if (
    current.leaseOwner !== leaseOwner ||
    current.attempt !== claimed.attempt ||
    !isOwnedPreparationVersion(current, claimed)
  ) {
    throw new Error("Rank preparation lease is no longer owned");
  }
  const now = await databaseClock(transaction);
  if (
    !current.leaseExpiresAt ||
    current.leaseExpiresAt <= now
  ) {
    throw new Error("Rank preparation lease has expired");
  }
  return current;
}

function isOwnedPreparationVersion(
  current: StoredRankJob,
  claimed: StoredRankJob
): boolean {
  if (
    current.version === claimed.version &&
    current.status === claimed.status
  ) {
    return true;
  }
  return (
    claimed.status === "PREPARING" &&
    current.status === "CANCEL_REQUESTED" &&
    current.version === claimed.version + 1 &&
    current.cancelRequestedAt !== null &&
    typeof current.rankRun?.cancelRequestedBy === "string"
  );
}

async function updateClaimedJob(
  transaction: Pick<Prisma.TransactionClient, "job">,
  current: Job,
  leaseOwner: string,
  data: Prisma.JobUpdateManyMutationInput
): Promise<void> {
  const changed = await transaction.job.updateMany({
    where: {
      id: current.id,
      type: MANUAL_RANK_CHECK_JOB_TYPE,
      status: current.status,
      version: current.version,
      leaseOwner
    },
    data
  });
  if (changed.count !== 1) {
    throw new Error("Rank preparation lease optimistic lock was lost");
  }
}

function hashBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!HASH_PATTERN.test(value)) {
    throw new Error("Invalid rank receipt hash");
  }
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function assertLeaseOwner(value: string): void {
  if (!LEASE_OWNER_PATTERN.test(value)) {
    throw new Error("Invalid rank preparation lease owner");
  }
}

function validManifestSealShape(seal: InternalRankManifestSeal): boolean {
  const pairCount = Number(seal.pairCount);
  const chunkCount = Number(seal.chunkCount);
  if (!Number.isSafeInteger(pairCount) || !Number.isSafeInteger(chunkCount)) {
    return false;
  }
  if (seal.chunkSize === String(legacyRankManifestChunkSize)) {
    return (
      pairCount >= 1 &&
      pairCount <= legacyRankProviderKeywordLimit &&
      chunkCount ===
        Math.ceil(pairCount / legacyRankManifestChunkSize)
    );
  }
  if (seal.chunkSize === String(xmlStockRankManifestChunkSize)) {
    return (
      seal.provider === "XMLSTOCK" &&
      pairCount >= 1 &&
      pairCount <= rankProviderKeywordLimit &&
      chunkCount === pairCount
    );
  }
  return (
    seal.chunkSize === String(rankManifestSingleTaskChunkSize) &&
    pairCount >= 1 &&
    pairCount <= rankProviderKeywordLimit &&
    chunkCount === 1
  );
}

function pendingLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return 100;
  return Math.min(value, 500);
}
