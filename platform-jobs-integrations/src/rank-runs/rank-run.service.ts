import { timingSafeEqual } from "node:crypto";
import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  rankRunConflictDetails,
  type InternalCancelRankJobInput,
  type InternalCreateRankRunInput,
  type InternalRankRunConflictDetails,
  type InternalRankJobQuery,
  type RankJobSummary,
  type RankRunConflictReason
} from "@seo-platform/contracts";
import { Prisma } from "../generated/prisma/client.js";
import type {
  Job,
  RankEstimate
} from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import { QueueService } from "../queue/queue.service.js";
import {
  RANK_ESTIMATE_VALIDATION_FRESHNESS_MILLISECONDS,
  RANK_ESTIMATE_POLICY_VERSION,
  credentialSnapshot,
  executionProjection,
  rankEstimateProjectDomainHash,
  verifiedRankEstimate,
  type CredentialSnapshot
} from "../rank-estimates/rank-estimate.service.js";
import {
  rankManifestCommand,
  rankManifestCommandHash,
  rankManifestCommandJson
} from "./rank-manifest-command.js";
import { lockTenantRankJobGraph } from "./rank-job-lock.js";
import {
  MANUAL_RANK_CHECK_JOB_TYPE,
  rankJobInputJson,
  rankJobScopeJson,
  rankRunDeduplicationKey,
  rankRunIdempotencyScope,
  rankRunRequestHash,
  rankRunRequestMatches,
  toRankJobSummary,
  type StoredRankJob
} from "./rank-job-record.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RANK_PREPARATION_MAX_ATTEMPTS = 20;
const CANCELLATION_TRANSACTION_ATTEMPTS = 3;

class RankJobConcurrencyError extends Error {}

@Injectable()
export class RankRunService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService
  ) {}

  public async create(
    input: InternalCreateRankRunInput,
    idempotencyKey: string,
    requestId: string
  ): Promise<RankJobSummary> {
    const idempotencyScope = rankRunIdempotencyScope(input.projectId);
    const requestHash = rankRunRequestHash(input);
    const replay = await findIdempotent(
      this.prisma,
      input.workspaceId,
      idempotencyScope,
      idempotencyKey
    );
    if (replay) {
      assertReplay(replay, input, requestHash);
      await this.enqueueForRecovery(replay);
      return toRankJobSummary(replay);
    }

    let stored: StoredRankJob;
    try {
      stored = await this.prisma.$transaction(
        async (transaction) => {
          const transactionReplay = await findIdempotent(
            transaction,
            input.workspaceId,
            idempotencyScope,
            idempotencyKey
          );
          if (transactionReplay) {
            assertReplay(transactionReplay, input, requestHash);
            return transactionReplay;
          }

          const estimate = await transaction.rankEstimate.findFirst({
            where: {
              id: input.estimateId,
              workspaceId: input.workspaceId,
              projectId: input.projectId
            }
          });
          if (!estimate) throw rankJobNotFound("Rank estimate not found");
          const [clock] = await transaction.$queryRaw<
            readonly {
              readonly jobId: string;
              readonly now: Date;
            }[]
          >`
            SELECT
              uuidv7()::text AS "jobId",
              clock_timestamp() AS "now"
          `;
          if (
            !clock ||
            !UUID_PATTERN.test(clock.jobId) ||
            !(clock.now instanceof Date) ||
            Number.isNaN(clock.now.getTime())
          ) {
            throw new Error("Unable to allocate manual rank Job");
          }

          const verified = verifiedRankEstimate(estimate);
          assertExecutableEstimate(estimate, verified, input, clock.now);
          const currentProjection = await executionProjection(
            transaction,
            input.workspaceId,
            input.projectId
          );
          assertExecutionProjectionCurrent(
            estimate,
            credentialSnapshot(currentProjection),
            clock.now
          );
          const execution = verified.execution;
          if (!execution) {
            throw rankJobConflict(
              "ESTIMATE_STALE",
              "Rank estimate execution snapshot is unavailable"
            );
          }
          const command = rankManifestCommand(
            input,
            estimate,
            execution,
            clock.jobId
          );
          await transaction.job.create({
            data: {
              id: clock.jobId,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              type: MANUAL_RANK_CHECK_JOB_TYPE,
              status: "PREPARING",
              stage: "PREPARING_SCOPE",
              priority: 100,
              actorId: input.actorId,
              deduplicationKey: rankRunDeduplicationKey(
                input.estimateId
              ),
              idempotencyScope,
              idempotencyKey,
              requestHash: databaseBytes(requestHash),
              inputSnapshot: rankJobInputJson(input),
              scopeSnapshot: rankJobScopeJson(
                input,
                estimate.trackingContextId
              ),
              progressCurrent: 0n,
              progressTotal: BigInt(estimate.keywordCount),
              progressUnit: "KEYWORD",
              estimatedCostMicro: 0n,
              currency: input.billingCurrency,
              credentialMode: "BYOK_API_KEY",
              provider: "ARSENKIN",
              maxAttempts: RANK_PREPARATION_MAX_ATTEMPTS,
              correlationId: boundedRequestId(requestId)
            }
          });
          await transaction.rankJobRun.create({
            data: {
              jobId: clock.jobId,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              estimateId: estimate.id,
              trackingContextId: estimate.trackingContextId,
              projectDomain: input.project.domain,
              projectStatus: "ACTIVE",
              projectVersion: input.project.version,
              manifestCommand: rankManifestCommandJson(command),
              manifestCommandHash: databaseBytes(
                rankManifestCommandHash(command)
              )
            }
          });
          return requiredRankJob(
            transaction,
            clock.jobId,
            input.workspaceId,
            input.projectId
          );
        },
        { isolationLevel: "RepeatableRead" }
      );
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const winner = await this.concurrentWinner(
        input,
        idempotencyScope,
        idempotencyKey,
        requestHash
      );
      if (!winner) throw error;
      stored = winner;
    }

    await this.enqueueForRecovery(stored);
    return toRankJobSummary(stored);
  }

  public async get(input: InternalRankJobQuery): Promise<RankJobSummary> {
    const stored = await findRankJob(
      this.prisma,
      input.jobId,
      input.workspaceId,
      input.projectId
    );
    if (!stored) throw rankJobNotFound("Manual rank Job not found");
    return toRankJobSummary(stored);
  }

  public async cancel(
    input: InternalCancelRankJobInput
  ): Promise<RankJobSummary> {
    for (
      let attempt = 1;
      attempt <= CANCELLATION_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const stored = await this.prisma.$transaction(
          async (transaction) => {
            const locked = await lockTenantRankJobGraph(transaction, input);
            if (!locked) {
              throw rankJobNotFound("Manual rank Job not found");
            }
            const current = await findRankJob(
              transaction,
              input.jobId,
              input.workspaceId,
              input.projectId
            );
            if (!current) {
              throw rankJobNotFound("Manual rank Job not found");
            }
            if (isTerminal(current.status)) return current;
            if (current.status === "CANCEL_REQUESTED") return current;
            const [clock] = await transaction.$queryRaw<
              readonly { readonly now: Date }[]
            >`SELECT clock_timestamp() AS "now"`;
            if (!clock?.now) {
              throw new Error("Unable to read database clock");
            }

            if (
              current.status === "PREPARING" &&
              current.rankRun?.sealState === "PENDING" &&
              current.rankRun.sealAttemptCount === 0
            ) {
              await updateRankJob(transaction, current, {
                status: "CANCELLED",
                stage: "FINISHED",
                cancelRequestedAt: clock.now,
                finishedAt: clock.now,
                leaseOwner: null,
                leaseExpiresAt: null,
                retryAt: null,
                version: { increment: 1 }
              });
              const runChanged = await transaction.rankJobRun.updateMany({
                where: {
                  jobId: current.id,
                  sealState: "PENDING",
                  sealAttemptCount: 0,
                  cancelRequestedBy: null
                },
                data: {
                  sealState: "NOT_SEALED",
                  cancelRequestedBy: input.actorId
                }
              });
              if (runChanged.count !== 1) {
                throw new RankJobConcurrencyError(
                  "Rank cancellation optimistic lock was lost"
                );
              }
            } else {
              await updateRankJob(transaction, current, {
                status: "CANCEL_REQUESTED",
                cancelRequestedAt: clock.now,
                version: { increment: 1 }
              });
              const runChanged = await transaction.rankJobRun.updateMany({
                where: {
                  jobId: current.id,
                  cancelRequestedBy: null
                },
                data: {
                  cancelRequestedBy: input.actorId
                }
              });
              if (runChanged.count !== 1) {
                throw new RankJobConcurrencyError(
                  "Rank cancellation audit race"
                );
              }
            }
            return requiredRankJob(
              transaction,
              current.id,
              input.workspaceId,
              input.projectId
            );
          },
          { isolationLevel: "ReadCommitted" }
        );
        await this.enqueueForRecovery(stored);
        return toRankJobSummary(stored);
      } catch (error) {
        if (
          attempt === CANCELLATION_TRANSACTION_ATTEMPTS ||
          !isConcurrencyFailure(error)
        ) {
          if (!isConcurrencyFailure(error)) throw error;
          break;
        }
      }
    }

    const current = await findRankJob(
      this.prisma,
      input.jobId,
      input.workspaceId,
      input.projectId
    );
    if (!current) throw rankJobNotFound("Manual rank Job not found");
    if (isTerminal(current.status) || current.status === "CANCEL_REQUESTED") {
      await this.enqueueForRecovery(current);
      return toRankJobSummary(current);
    }
    throw new HttpException(
      {
        error: {
          code: "DEPENDENCY_UNAVAILABLE",
          message: "Rank Job changed concurrently; retry cancellation"
        }
      },
      HttpStatus.SERVICE_UNAVAILABLE
    );
  }

  private async concurrentWinner(
    input: InternalCreateRankRunInput,
    idempotencyScope: string,
    idempotencyKey: string,
    requestHash: Buffer
  ): Promise<StoredRankJob | undefined> {
    const replay = await findIdempotent(
      this.prisma,
      input.workspaceId,
      idempotencyScope,
      idempotencyKey
    );
    if (replay) {
      assertReplay(replay, input, requestHash);
      return replay;
    }
    const equivalent = await this.prisma.rankJobRun.findFirst({
      where: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        estimateId: input.estimateId
      },
      select: { jobId: true }
    });
    if (equivalent) {
      throw rankJobConflict(
        "EQUIVALENT_RUN_ACTIVE",
        "This rank estimate was already used",
        {
          reason: "EQUIVALENT_RUN_ACTIVE",
          existingJobId: equivalent.jobId
        }
      );
    }
    return undefined;
  }

  private async enqueueForRecovery(stored: StoredRankJob): Promise<void> {
    if (
      stored.status !== "PREPARING" &&
      stored.status !== "CANCEL_REQUESTED"
    ) {
      return;
    }
    try {
      await this.queue.enqueueRankPreparation(stored.id);
    } catch {
      // PostgreSQL is authoritative. The rank worker dispatcher recovers
      // accepted commands whose best-effort BullMQ notification was lost.
    }
  }
}

function assertExecutableEstimate(
  stored: RankEstimate,
  verified: ReturnType<typeof verifiedRankEstimate>,
  input: InternalCreateRankRunInput,
  now: Date
): void {
  if (stored.expiresAt.getTime() <= now.getTime()) {
    throw rankJobConflict(
      "ESTIMATE_EXPIRED",
      "Rank estimate has expired"
    );
  }
  if (
    verified.summary.status !== "READY" ||
    !verified.summary.executionAllowed ||
    verified.summary.blockers.length !== 0 ||
    !verified.execution ||
    stored.providerPolicyVersion !== RANK_ESTIMATE_POLICY_VERSION
  ) {
    throw rankJobConflict(
      "ESTIMATE_STALE",
      "Rank estimate is not executable"
    );
  }
  if (
    input.project.status !== "ACTIVE" ||
    input.project.version !== stored.projectVersion ||
    !bytesEqual(
      stored.projectDomainHash,
      rankEstimateProjectDomainHash(input.project.domain)
    ) ||
    input.billingCurrency !== verified.summary.billingCurrency
  ) {
    throw rankJobConflict(
      "ESTIMATE_STALE",
      "Project changed after rank estimate calculation"
    );
  }
  if (
    input.access.workspaceStatus !== "ACTIVE" ||
    !input.access.canRunRanking ||
    input.access.entitlementStatus !== "ALLOWED" ||
    input.access.quota.status !== "AVAILABLE" ||
    BigInt(input.access.quota.remaining) < 1n
  ) {
    throw rankJobConflict(
      "EXECUTION_GRANT_DENIED",
      "Current access does not allow a rank run"
    );
  }
}

export function assertExecutionProjectionCurrent(
  estimate: RankEstimate,
  current: CredentialSnapshot,
  now: Date
): void {
  const valuesMatch =
    current.bindingId === value(estimate.bindingId) &&
    current.bindingVersion === value(estimate.bindingVersion) &&
    current.routeId === value(estimate.routeId) &&
    current.credentialId === value(estimate.credentialId) &&
    current.credentialStatus === value(estimate.credentialStatus) &&
    current.credentialVersion === value(estimate.credentialVersion) &&
    current.credentialMaterialVersion ===
      value(estimate.credentialMaterialVersion) &&
    dateEqual(current.credentialDeletedAt, estimate.credentialDeletedAt) &&
    current.validationId === value(estimate.credentialValidationId) &&
    current.validationVersion ===
      value(estimate.credentialValidationVersion) &&
    current.validationConnectorVersion ===
      value(estimate.credentialValidationConnectorVersion) &&
    dateEqual(
      current.validationFinishedAt,
      estimate.credentialValidationFinishedAt
    ) &&
    dateEqual(current.verifiedAt, estimate.credentialVerifiedAt);
  const validationAt = current.validationFinishedAt;
  const validationAge = validationAt
    ? now.getTime() - validationAt.getTime()
    : Number.POSITIVE_INFINITY;
  if (
    !valuesMatch ||
    current.credentialStatus !== "ACTIVE" ||
    current.credentialDeletedAt !== undefined ||
    !validationAt ||
    validationAge < 0 ||
    validationAge > RANK_ESTIMATE_VALIDATION_FRESHNESS_MILLISECONDS
  ) {
    throw rankJobConflict(
      "ESTIMATE_STALE",
      "Connector configuration changed after rank estimate calculation"
    );
  }
}

function value<T>(input: T | null): T | undefined {
  return input === null ? undefined : input;
}

function dateEqual(left: Date | undefined, right: Date | null): boolean {
  return left?.getTime() === (right?.getTime() ?? undefined);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return (
    a.length === b.length &&
    a.length === 32 &&
    timingSafeEqual(a, b)
  );
}

function assertReplay(
  stored: StoredRankJob,
  input: InternalCreateRankRunInput,
  requestHash: Buffer
): void {
  if (
    !rankRunRequestMatches(stored.requestHash, requestHash) ||
    stored.workspaceId !== input.workspaceId ||
    stored.projectId !== input.projectId ||
    stored.rankRun?.estimateId !== input.estimateId ||
    stored.actorId !== input.actorId
  ) {
    throw rankJobConflict(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was used for another rank run"
    );
  }
}

function findIdempotent(
  transaction: Pick<Prisma.TransactionClient, "job">,
  workspaceId: string,
  idempotencyScope: string,
  idempotencyKey: string
): Promise<StoredRankJob | null> {
  return transaction.job.findUnique({
    where: {
      workspaceId_idempotencyScope_idempotencyKey: {
        workspaceId,
        idempotencyScope,
        idempotencyKey
      }
    },
    include: { rankRun: true }
  });
}

function findRankJob(
  transaction: Pick<Prisma.TransactionClient, "job">,
  jobId: string,
  workspaceId: string,
  projectId: string
): Promise<StoredRankJob | null> {
  return transaction.job.findFirst({
    where: {
      id: jobId,
      workspaceId,
      projectId,
      type: MANUAL_RANK_CHECK_JOB_TYPE
    },
    include: { rankRun: true }
  });
}

async function requiredRankJob(
  transaction: Pick<Prisma.TransactionClient, "job">,
  jobId: string,
  workspaceId: string,
  projectId: string
): Promise<StoredRankJob> {
  const stored = await findRankJob(
    transaction,
    jobId,
    workspaceId,
    projectId
  );
  if (!stored) throw new Error("Manual rank Job was not persisted");
  return stored;
}

async function updateRankJob(
  transaction: Pick<Prisma.TransactionClient, "job">,
  current: Job,
  data: Prisma.JobUpdateManyMutationInput
): Promise<void> {
  const changed = await transaction.job.updateMany({
    where: {
      id: current.id,
      workspaceId: current.workspaceId,
      projectId: current.projectId,
      type: MANUAL_RANK_CHECK_JOB_TYPE,
      status: current.status,
      version: current.version
    },
    data
  });
  if (changed.count !== 1) {
    throw new RankJobConcurrencyError(
      "Manual rank Job optimistic lock was lost"
    );
  }
}

function isTerminal(status: Job["status"]): boolean {
  return [
    "CANCELLED",
    "PARTIALLY_COMPLETED",
    "COMPLETED",
    "FAILED_FINAL",
    "EXPIRED",
    "ACTION_REQUIRED"
  ].includes(status);
}

function isConcurrencyFailure(error: unknown, depth = 0): boolean {
  if (depth > 4 || typeof error !== "object" || error === null) {
    return false;
  }
  if (error instanceof RankJobConcurrencyError) return true;
  const candidate = error as {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly cause?: unknown;
    readonly meta?: unknown;
    readonly driverAdapterError?: unknown;
    readonly originalCode?: unknown;
  };
  if (
    candidate.code === "P2034" ||
    candidate.code === "40P01" ||
    candidate.code === "40001" ||
    candidate.originalCode === "40P01" ||
    candidate.originalCode === "40001"
  ) {
    return true;
  }
  if (
    typeof candidate.message === "string" &&
    /\b(?:40P01|40001|deadlock|serialization failure)\b/iu.test(
      candidate.message
    )
  ) {
    return true;
  }
  return (
    isConcurrencyFailure(candidate.cause, depth + 1) ||
    isConcurrencyFailure(candidate.meta, depth + 1) ||
    isConcurrencyFailure(candidate.driverAdapterError, depth + 1)
  );
}

function rankJobConflict(
  code: RankRunConflictReason | "IDEMPOTENCY_CONFLICT",
  message: string,
  details?: InternalRankRunConflictDetails
): HttpException {
  let safeDetails: InternalRankRunConflictDetails | undefined;
  if (code !== "IDEMPOTENCY_CONFLICT") {
    try {
      safeDetails = rankRunConflictDetails(
        code === "EQUIVALENT_RUN_ACTIVE"
          ? details
          : { reason: code }
      );
    } catch {
      throw new Error("Rank Job conflict details are invalid");
    }
    if (safeDetails.reason !== code) {
      throw new Error("Rank Job conflict reason does not match its code");
    }
  }
  return new HttpException(
    {
      error: {
        code,
        message,
        ...(safeDetails ? { details: safeDetails } : {})
      }
    },
    HttpStatus.CONFLICT
  );
}

function rankJobNotFound(message: string): NotFoundException {
  return new NotFoundException(message);
}

function boundedRequestId(value: string): string {
  if (value.length >= 1 && value.length <= 100) return value;
  return "rank-run";
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function databaseBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}
