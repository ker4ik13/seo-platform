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
  type InternalRetryRankJobInput,
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
import { databaseClock } from "../database/database-clock.js";
import { PrismaService } from "../database/prisma.service.js";
import { assertJobCapacity } from "../jobs/job-capacity.js";
import { QueueService } from "../queue/queue.service.js";
import {
  RANK_ESTIMATE_VALIDATION_FRESHNESS_MILLISECONDS,
  credentialSnapshot,
  executionProjection,
  rankEstimateContinuationScopeHash,
  rankProviderPolicyVersion,
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
import { createContinuationEstimate } from "./rank-continuation-estimate.js";
import {
  MANUAL_RANK_CHECK_JOB_TYPE,
  rankJobInputJson,
  rankJobScopeJson,
  rankRunDeduplicationKey,
  rankRunIdempotencyScope,
  rankRunRequestHash,
  rankRunRequestMatches,
  rankRetryIdempotencyScope,
  rankRetryRequestHash,
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
          await assertJobCapacity(
            transaction,
            input.workspaceId,
            input.jobCapacity
          );

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
            input.projectId,
            estimate.provider as "ARSENKIN" | "XMLSTOCK",
            estimate.routeId ?? undefined
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
                estimate.trackingContextId,
                execution,
                verified.summary
              ),
              progressCurrent: 0n,
              progressTotal: BigInt(estimate.keywordCount),
              progressUnit: "KEYWORD",
              estimatedCostMicro: 0n,
              currency: input.billingCurrency,
              credentialMode: "BYOK_API_KEY",
              provider: estimate.provider,
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

  public async retryMissing(
    input: InternalRetryRankJobInput,
    idempotencyKey: string,
    requestId: string
  ): Promise<RankJobSummary> {
    const idempotencyScope = rankRetryIdempotencyScope(input.jobId);
    const requestHash = rankRetryRequestHash(input);
    const replay = await findIdempotent(
      this.prisma,
      input.workspaceId,
      idempotencyScope,
      idempotencyKey
    );
    if (replay) {
      assertRetryReplay(replay, input, requestHash);
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
            assertRetryReplay(transactionReplay, input, requestHash);
            return transactionReplay;
          }
          const existingChild = await transaction.job.findFirst({
            where: {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              type: MANUAL_RANK_CHECK_JOB_TYPE,
              parentJobId: input.jobId
            },
            include: { rankRun: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }]
          });
          if (existingChild) return existingChild;

          const parent = await transaction.job.findFirst({
            where: {
              id: input.jobId,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              type: MANUAL_RANK_CHECK_JOB_TYPE
            },
            include: {
              rankRun: { include: { estimate: true } }
            }
          });
          if (!parent?.rankRun) {
            throw rankJobNotFound("Partial rank Job not found");
          }
          const parentSummary = toRankJobSummary(parent);
          if (
            parentSummary.status !== "PARTIALLY_COMPLETED" ||
            BigInt(parentSummary.result.failedCount) < 1n ||
            BigInt(parentSummary.result.submitOutcomeUnknownCount) !== 0n
          ) {
            throw rankJobConflict(
              "ESTIMATE_STALE",
              "Only a safely finalized partial rank run can be continued"
            );
          }
          const missingCount = Number(parentSummary.result.failedCount);
          if (
            !Number.isSafeInteger(missingCount) ||
            missingCount < 1 ||
            missingCount > Number(parent.progressTotal)
          ) {
            throw new Error("Partial rank Job has an invalid missing count");
          }
          await assertJobCapacity(
            transaction,
            input.workspaceId,
            input.jobCapacity
          );
          const [clock] = await transaction.$queryRaw<
            readonly {
              readonly jobId: string;
              readonly estimateId: string;
              readonly now: Date;
            }[]
          >`
            SELECT
              uuidv7()::text AS "jobId",
              uuidv7()::text AS "estimateId",
              clock_timestamp() AS "now"
          `;
          if (
            !clock ||
            !UUID_PATTERN.test(clock.jobId) ||
            !UUID_PATTERN.test(clock.estimateId) ||
            !(clock.now instanceof Date) ||
            Number.isNaN(clock.now.getTime())
          ) {
            throw new Error("Unable to allocate rank continuation Job");
          }
          const estimate = parent.rankRun.estimate;
          const verified = verifiedRankEstimate(estimate);
          assertRetryableEstimate(estimate, verified, input);
          const currentProjection = await executionProjection(
            transaction,
            input.workspaceId,
            input.projectId,
            estimate.provider as "ARSENKIN" | "XMLSTOCK",
            estimate.routeId ?? undefined
          );
          const currentCredential = credentialSnapshot(currentProjection);
          assertExecutionProjectionCurrent(
            estimate,
            currentCredential,
            clock.now,
            { allowNewerValidation: true }
          );
          const execution = verified.execution;
          if (!execution) {
            throw rankJobConflict(
              "ESTIMATE_STALE",
              "Rank continuation execution snapshot is unavailable"
            );
          }
          const continuationEstimate = await createContinuationEstimate(
            transaction,
            estimate,
            verified.summary,
            execution,
            {
              id: clock.estimateId,
              actorId: input.actorId,
              idempotencyScope: `rank-estimate-retry:${parent.id}`,
              idempotencyKey,
              requestHash,
              calculatedAt: clock.now,
              pairCount: missingCount,
              credential: currentCredential,
              scopeHash: rankEstimateContinuationScopeHash(
                estimate,
                currentCredential
              )
            }
          );
          const continuationSummary = verifiedRankEstimate(
            continuationEstimate
          ).summary;
          const createInput: InternalCreateRankRunInput = {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            actorId: input.actorId,
            estimateId: continuationEstimate.id,
            project: input.project,
            access: input.access,
            billingCurrency: input.billingCurrency,
            jobCapacity: input.jobCapacity
          };
          const command = rankManifestCommand(
            createInput,
            continuationEstimate,
            execution,
            clock.jobId,
            {
              parentJobId: parent.id,
              pairCount: missingCount,
              expiresAt: continuationEstimate.expiresAt
            }
          );
          await transaction.job.create({
            data: {
              id: clock.jobId,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              type: MANUAL_RANK_CHECK_JOB_TYPE,
              status: "PREPARING",
              stage: "PREPARING_SCOPE",
              priority: 90,
              actorId: input.actorId,
              parentJobId: parent.id,
              deduplicationKey: `manual-rank-retry:${parent.id}`,
              idempotencyScope,
              idempotencyKey,
              requestHash: databaseBytes(requestHash),
              inputSnapshot: rankJobInputJson(createInput),
              scopeSnapshot: rankJobScopeJson(
                createInput,
                continuationEstimate.trackingContextId,
                execution,
                continuationSummary
              ),
              progressCurrent: 0n,
              progressTotal: BigInt(missingCount),
              progressUnit: "KEYWORD",
              estimatedCostMicro: 0n,
              currency: input.billingCurrency,
              credentialMode: "BYOK_API_KEY",
              provider: continuationEstimate.provider,
              maxAttempts: RANK_PREPARATION_MAX_ATTEMPTS,
              correlationId: boundedRequestId(requestId)
            }
          });
          await transaction.rankJobRun.create({
            data: {
              jobId: clock.jobId,
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              estimateId: continuationEstimate.id,
              trackingContextId: continuationEstimate.trackingContextId,
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
      const winner =
        (await findIdempotent(
          this.prisma,
          input.workspaceId,
          idempotencyScope,
          idempotencyKey
        )) ??
        (await this.prisma.job.findFirst({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            type: MANUAL_RANK_CHECK_JOB_TYPE,
            parentJobId: input.jobId
          },
          include: { rankRun: true }
        }));
      if (!winner) throw error;
      stored = winner;
    }

    await this.enqueueForRecovery(stored);
    return toRankJobSummary(stored);
  }

  public async list(
    workspaceId: string,
    projectId: string
  ): Promise<readonly RankJobSummary[]> {
    const jobs = await this.prisma.job.findMany({
      where: {
        workspaceId,
        projectId,
        type: MANUAL_RANK_CHECK_JOB_TYPE
      },
      include: { rankRun: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 25
    });
    return jobs.map(toRankJobSummary);
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
            // SEO Data finalization is the point of no return. Once this
            // stage starts, an idempotent receipt may already exist even if
            // the local Jobs transaction still needs recovery.
            if (
              current.status === "RUNNING" &&
              current.stage === "FINALIZING"
            ) {
              return current;
            }
            const now = await databaseClock(transaction);

            if (
              current.status === "PREPARING" &&
              current.rankRun?.sealState === "PENDING" &&
              current.rankRun.sealAttemptCount === 0
            ) {
              await updateRankJob(transaction, current, {
                status: "CANCELLED",
                stage: "FINISHED",
                cancelRequestedAt: now,
                finishedAt: now,
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
                cancelRequestedAt: now,
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
    !rankEstimatePolicyMatchesProvider(
      stored.provider,
      stored.providerPolicyVersion
    )
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

function assertRetryableEstimate(
  stored: RankEstimate,
  verified: ReturnType<typeof verifiedRankEstimate>,
  input: InternalRetryRankJobInput
): void {
  if (
    verified.summary.status !== "READY" ||
    !verified.summary.executionAllowed ||
    verified.summary.blockers.length !== 0 ||
    !verified.execution ||
    !rankEstimatePolicyMatchesProvider(
      stored.provider,
      stored.providerPolicyVersion
    ) ||
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
      "The partial rank run configuration changed"
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
      "Current access does not allow a rank continuation"
    );
  }
}

export function rankEstimatePolicyMatchesProvider(
  provider: string,
  providerPolicyVersion: string
): boolean {
  if (provider !== "ARSENKIN" && provider !== "XMLSTOCK") return false;
  return providerPolicyVersion === rankProviderPolicyVersion(provider);
}

export function assertExecutionProjectionCurrent(
  estimate: RankEstimate,
  current: CredentialSnapshot,
  now: Date,
  options: { readonly allowNewerValidation?: boolean } = {}
): void {
  const immutableValuesMatch =
    current.bindingId === value(estimate.bindingId) &&
    current.bindingVersion === value(estimate.bindingVersion) &&
    current.routeId === value(estimate.routeId) &&
    current.credentialId === value(estimate.credentialId) &&
    current.credentialMaterialVersion ===
      value(estimate.credentialMaterialVersion) &&
    dateEqual(current.credentialDeletedAt, estimate.credentialDeletedAt) &&
    current.validationConnectorVersion ===
      value(estimate.credentialValidationConnectorVersion);
  const exactValidation =
    current.credentialVersion === value(estimate.credentialVersion) &&
    current.validationId === value(estimate.credentialValidationId) &&
    current.validationVersion ===
      value(estimate.credentialValidationVersion) &&
    dateEqual(
      current.validationFinishedAt,
      estimate.credentialValidationFinishedAt
    ) &&
    dateEqual(current.verifiedAt, estimate.credentialVerifiedAt);
  const newerValidation =
    options.allowNewerValidation === true &&
    current.validationId !== undefined &&
    current.validationId !== value(estimate.credentialValidationId) &&
    current.validationVersion !== undefined &&
    current.credentialVersion !== undefined &&
    estimate.credentialVersion !== null &&
    current.credentialVersion > estimate.credentialVersion &&
    current.validationFinishedAt !== undefined &&
    estimate.credentialValidationFinishedAt !== null &&
    current.validationFinishedAt.getTime() >
      estimate.credentialValidationFinishedAt.getTime() &&
    current.verifiedAt !== undefined &&
    estimate.credentialVerifiedAt !== null &&
    current.verifiedAt.getTime() > estimate.credentialVerifiedAt.getTime() &&
    current.validationFinishedAt.getTime() === current.verifiedAt.getTime();
  const validationAt = current.validationFinishedAt;
  const validationAge = validationAt
    ? now.getTime() - validationAt.getTime()
    : Number.POSITIVE_INFINITY;
  if (
    !immutableValuesMatch ||
    (!exactValidation && !newerValidation) ||
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

function assertRetryReplay(
  stored: StoredRankJob,
  input: InternalRetryRankJobInput,
  requestHash: Buffer
): void {
  if (
    !rankRunRequestMatches(stored.requestHash, requestHash) ||
    stored.workspaceId !== input.workspaceId ||
    stored.projectId !== input.projectId ||
    stored.parentJobId !== input.jobId ||
    stored.actorId !== input.actorId
  ) {
    throw rankJobConflict(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency key was used for another rank continuation"
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
