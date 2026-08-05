import { timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  currentRankProviderPolicyVersion,
  internalRankExecutionGrantDecision,
  legacyRankManifestChunkSize,
  legacyRankProviderKeywordLimit,
  legacyRankProviderPolicyVersion,
  rankManifestSingleTaskChunkSize,
  rankProviderKeywordLimit,
  xmlStockRankManifestChunkSize,
  xmlStockRankProviderPolicyVersion,
  type InternalIssueRankExecutionGrantInputV1,
  type InternalRankExecutionGrantDecisionV1
} from "@seo-platform/contracts";
import { canonicalizeJson } from "@seo-platform/contracts/canonical-json";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { Prisma } from "../generated/prisma/client.js";
import type {
  Job,
  JobItem,
  RankEstimate,
  RankExecutionGrantAttempt,
  RankExecutionGrantAttemptStatus,
  RankJobRun,
  RankProviderRequestIntent
} from "../generated/prisma/client.js";
import { databaseClock as readDatabaseClock } from "../database/database-clock.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  RankExecutionGrantClient,
  RankExecutionGrantClientError
} from "../platform-api/rank-execution-grant.client.js";
import {
  credentialSnapshot,
  executionProjection,
  rankEstimateProjectDomainHash,
  verifiedRankEstimate,
  type CredentialSnapshot,
  type ExecutionProjection
} from "../rank-estimates/rank-estimate.service.js";
import {
  rankExecutionGrantAttemptIdempotencyKey,
  rankExecutionGrantDecisionJson,
  rankExecutionGrantDecisionTransition,
  rankExecutionGrantHashes,
  rankExecutionGrantRequestJson,
  storedRankExecutionGrantRequest
} from "./rank-execution-grant-attempt.js";
import {
  rankExecutionConnectorVersion,
  rankExecutionKillSwitchVersion
} from "./rank-execution-evidence.js";
import {
  buildRankExecutionGrantRequest,
  type BuiltRankExecutionGrantRequest,
  type RankExecutionGrantRequestFacts
} from "./rank-execution-grant-request.js";
import {
  lockRankExecutionGrantAttempt,
  lockRankExecutionProjection,
  lockRankJobGraph,
  lockRankJobItem,
  type LockedRankJobIdentity,
  type RankExecutionProjectionIdentity
} from "./rank-job-lock.js";
import { rankJobItemReference } from "./rank-job-item.js";
import {
  RankProviderRequestIntentError,
  RankProviderRequestIntentService,
  storedRankProviderRequestIntent,
  type RankProviderRequestIntentBinding
} from "./rank-provider-request-intent.service.js";
import {
  MANUAL_RANK_CHECK_JOB_TYPE,
  rankJobAuthorizationSnapshot
} from "./rank-job-record.js";
import { assertExecutionProjectionCurrent } from "./rank-run.service.js";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;

export type RankExecutionGrantAttemptErrorCode =
  | "SUBMIT_DISABLED"
  | "INVALID_REQUEST"
  | "ITEM_NOT_FOUND"
  | "LOCAL_STATE_INVALID"
  | "ATTEMPT_TERMINAL"
  | "DEPENDENCY_UNAVAILABLE"
  | "DECISION_REJECTED";

export class RankExecutionGrantAttemptError extends Error {
  public constructor(
    public readonly code: RankExecutionGrantAttemptErrorCode,
    public readonly retryable: boolean,
    public readonly detail?: string
  ) {
    super(code);
    this.name = "RankExecutionGrantAttemptError";
  }
}

export interface RankExecutionGrantAttemptResult {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly executionAttempt: number;
  readonly status: RankExecutionGrantAttemptStatus;
  readonly expiresAt?: string;
  readonly decision?: InternalRankExecutionGrantDecisionV1;
}

type RankGrantJobGraph = Job & {
  readonly rankRun:
    | (RankJobRun & { readonly estimate: RankEstimate })
    | null;
};

interface PreparedRankExecutionGrantAttempt {
  readonly attempt: RankExecutionGrantAttempt;
  readonly request: InternalIssueRankExecutionGrantInputV1;
}

interface LockedRankExecutionGraph {
  readonly identity: LockedRankJobIdentity;
  readonly job: RankGrantJobGraph;
  readonly item: JobItem;
  readonly requestIntent: RankProviderRequestIntent | null;
  readonly projectionIdentity: RankExecutionProjectionIdentity;
  readonly projection: ExecutionProjection;
  readonly databaseNow: Date;
}

@Injectable()
export class RankExecutionGrantAttemptService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly client: RankExecutionGrantClient,
    private readonly requestIntents: RankProviderRequestIntentService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  /**
   * Persists the exact authorization intent before crossing the network.
   * A positive decision is consumed only with a secret-free scoped connector
   * execution in a second local transaction. No provider action is exposed by
   * this service.
   */
  public async issueForItem(
    jobItemId: string,
    requestId: string
  ): Promise<RankExecutionGrantAttemptResult> {
    if (
      !this.config.rankPreparation.enabled ||
      !this.config.rankGrantApiToken
    ) {
      throw failure("SUBMIT_DISABLED", false);
    }
    if (!UUID_V7_PATTERN.test(jobItemId)) {
      throw failure("ITEM_NOT_FOUND", false);
    }
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      throw failure("INVALID_REQUEST", false);
    }

    try {
      await this.requestIntents.ensureForItem(jobItemId);
    } catch (error) {
      if (error instanceof RankProviderRequestIntentError) {
        throw failure(error.code, error.retryable);
      }
      throw failure("DEPENDENCY_UNAVAILABLE", true);
    }

    const prepared = await this.prepare(jobItemId);
    if (prepared.attempt.status === "GRANTED_PENDING_CONSUME") {
      return this.consumePending(prepared.attempt);
    }
    if (prepared.attempt.status !== "REQUESTED") {
      return attemptResult(prepared.attempt);
    }

    let decision: InternalRankExecutionGrantDecisionV1;
    try {
      decision = await this.client.issue(prepared.request, {
        requestId,
        idempotencyKey: prepared.attempt.idempotencyKey
      });
    } catch (error) {
      if (
        error instanceof RankExecutionGrantClientError &&
        error.retryable
      ) {
        throw failure("DEPENDENCY_UNAVAILABLE", true);
      }
      try {
        await this.rejectPending(prepared.attempt);
      } catch {
        throw failure("DEPENDENCY_UNAVAILABLE", true);
      }
      throw failure("DECISION_REJECTED", false);
    }

    const recorded = await this.recordDecision(
      prepared.attempt,
      decision
    );
    return recorded.status === "GRANTED_PENDING_CONSUME"
      ? this.consumePending(prepared.attempt)
      : recorded;
  }

  private async prepare(
    jobItemId: string
  ): Promise<PreparedRankExecutionGrantAttempt> {
    const pointer = await this.prisma.jobItem.findUnique({
      where: { id: jobItemId },
      select: {
        jobId: true,
        workspaceId: true,
        projectId: true
      }
    });
    if (!pointer?.projectId) throw failure("ITEM_NOT_FOUND", false);

    return this.prisma.$transaction(
      async (transaction) => {
        const locked = await lockedExecutionGraph(
          transaction,
          pointer.jobId,
          jobItemId,
          false
        );
        if (
          locked.identity.workspaceId !== pointer.workspaceId ||
          locked.identity.projectId !== pointer.projectId
        ) {
          throw failure("ITEM_NOT_FOUND", false);
        }

        const latest =
          await transaction.rankExecutionGrantAttempt.findFirst({
            where: {
              workspaceId: locked.identity.workspaceId,
              jobItemId
            },
            orderBy: { executionAttempt: "desc" }
          });
        const clock = locked.databaseNow;
        let executionAttempt = 1;

        if (latest) {
          if (latest.status === "REQUESTED") {
            try {
              const built = requestForLockedGraph(
                locked,
                latest.executionAttempt,
                this.config
              );
              assertExactAttempt(latest, built);
              return { attempt: latest, request: built.request };
            } catch {
              return {
                attempt: await rejectLocal(
                  transaction,
                  latest,
                  clock
                ),
                request: storedRankExecutionGrantRequest(
                  latest.requestSnapshot
                )
              };
            }
          }
          if (latest.status === "GRANTED_PENDING_CONSUME") {
            if (!latest.expiresAt) {
              throw failure("LOCAL_STATE_INVALID", false);
            }
            if (clock.getTime() < latest.expiresAt.getTime()) {
              return {
                attempt: latest,
                request: storedRankExecutionGrantRequest(
                  latest.requestSnapshot
                )
              };
            }
            const expired =
              await transaction.rankExecutionGrantAttempt.update({
                where: { id: latest.id },
                data: {
                  status: "EXPIRED",
                  terminalAt: clock
                }
              });
            executionAttempt = expired.executionAttempt + 1;
          } else if (latest.status === "EXPIRED") {
            executionAttempt = latest.executionAttempt + 1;
          } else if (latest.status === "CONSUMED") {
            const execution =
              await transaction.rankConnectorExecution.findUnique({
                where: { grantAttemptId: latest.id },
                select: {
                  status: true,
                  authorizationExpiresAt: true,
                  submitAttemptCount: true,
                  submitBytesStartedAt: true,
                  providerTaskId: true
                }
              });
            if (
              !isExpiredUnusedAuthorization(
                execution,
                locked.databaseNow
              )
            ) {
              return {
                attempt: latest,
                request: storedRankExecutionGrantRequest(
                  latest.requestSnapshot
                )
              };
            }
            executionAttempt = latest.executionAttempt + 1;
          } else {
            return {
              attempt: latest,
              request: storedRankExecutionGrantRequest(
                latest.requestSnapshot
              )
            };
          }
        }

        if (executionAttempt > 1_000) {
          throw failure("ATTEMPT_TERMINAL", false);
        }
        const built = requestForLockedGraph(
          locked,
          executionAttempt,
          this.config
        );
        const hashes = rankExecutionGrantHashes(built.request);
        const idempotencyKey =
          rankExecutionGrantAttemptIdempotencyKey(
            jobItemId,
            executionAttempt
          );
        const attempt =
          await transaction.rankExecutionGrantAttempt.create({
            data: {
              workspaceId: locked.identity.workspaceId,
              projectId: locked.identity.projectId,
              jobId: locked.identity.jobId,
              jobItemId,
              executionAttempt,
              jobVersion: locked.job.version,
              idempotencyKey,
              requestSnapshot: rankExecutionGrantRequestJson(
                built.request
              ),
              requestHash: Uint8Array.from(hashes.requestHash),
              scopeHash: Uint8Array.from(hashes.scopeHash),
              executionEvidenceHash: Uint8Array.from(
                Buffer.from(built.evidenceHash.value, "hex")
              )
            }
          });
        return { attempt, request: built.request };
      },
      { isolationLevel: "ReadCommitted" }
    );
  }

  private async recordDecision(
    prepared: RankExecutionGrantAttempt,
    value: InternalRankExecutionGrantDecisionV1
  ): Promise<RankExecutionGrantAttemptResult> {
    return this.prisma.$transaction(
      async (transaction) => {
        const locked = await lockedExecutionGraph(
          transaction,
          prepared.jobId,
          prepared.jobItemId,
          false
        );
        if (
          locked.identity.workspaceId !== prepared.workspaceId ||
          locked.identity.projectId !== prepared.projectId ||
          !(await lockRankExecutionGrantAttempt(
            transaction,
            locked.identity,
            prepared.jobItemId,
            prepared.id
          ))
        ) {
          throw failure("LOCAL_STATE_INVALID", false);
        }
        const current =
          await transaction.rankExecutionGrantAttempt.findUnique({
            where: { id: prepared.id }
          });
        if (!current) throw failure("LOCAL_STATE_INVALID", false);
        if (current.status !== "REQUESTED") {
          assertSettledDecision(current, value);
          return attemptResult(current);
        }

        const request = storedRankExecutionGrantRequest(
          current.requestSnapshot
        );
        const decision = internalRankExecutionGrantDecision(value);
        const clock = await databaseClock(transaction);
        let transition: ReturnType<
          typeof rankExecutionGrantDecisionTransition
        >;
        try {
          transition = rankExecutionGrantDecisionTransition(
            request,
            decision,
            clock
          );
        } catch {
          return attemptResult(
            await rejectLocal(transaction, current, clock)
          );
        }

        if (transition.status === "DENIED") {
          return attemptResult(
            await transaction.rankExecutionGrantAttempt.update({
              where: { id: current.id },
              data: {
                status: "DENIED",
                decisionSnapshot: rankExecutionGrantDecisionJson(
                  transition.decision
                ),
                decidedAt: new Date(transition.decision.decidedAt),
                terminalAt: clock
              }
            })
          );
        }
        if (transition.status === "EXPIRED") {
          return attemptResult(
            await transaction.rankExecutionGrantAttempt.update({
              where: { id: current.id },
              data: {
                status: "EXPIRED",
                decisionSnapshot: rankExecutionGrantDecisionJson(
                  transition.decision
                ),
                decidedAt: new Date(transition.decision.decidedAt),
                expiresAt: transition.expiresAt,
                terminalAt: clock
              }
            })
          );
        }

        try {
          const rebuilt = requestForLockedGraph(
            { ...locked, databaseNow: clock },
            current.executionAttempt,
            this.config
          );
          assertExactAttempt(current, rebuilt);
        } catch {
          return attemptResult(
            await rejectLocal(
              transaction,
              current,
              clock,
              transition.decision,
              transition.expiresAt
            )
          );
        }

        return attemptResult(
          await transaction.rankExecutionGrantAttempt.update({
            where: { id: current.id },
            data: {
              status: "GRANTED_PENDING_CONSUME",
              decisionSnapshot: rankExecutionGrantDecisionJson(
                transition.decision
              ),
              decidedAt: new Date(transition.decision.decidedAt),
              expiresAt: transition.expiresAt
            }
          })
        );
      },
      { isolationLevel: "ReadCommitted" }
    );
  }

  private async rejectPending(
    prepared: RankExecutionGrantAttempt
  ): Promise<void> {
    await this.prisma.$transaction(
      async (transaction) => {
        const locked = await lockedExecutionGraph(
          transaction,
          prepared.jobId,
          prepared.jobItemId,
          false
        );
        if (
          locked.identity.workspaceId !== prepared.workspaceId ||
          locked.identity.projectId !== prepared.projectId ||
          !(await lockRankExecutionGrantAttempt(
            transaction,
            locked.identity,
            prepared.jobItemId,
            prepared.id
          ))
        ) {
          throw failure("LOCAL_STATE_INVALID", false);
        }
        const current =
          await transaction.rankExecutionGrantAttempt.findUnique({
            where: { id: prepared.id }
          });
        if (!current || current.status !== "REQUESTED") return;
        await rejectLocal(
          transaction,
          current,
          await databaseClock(transaction)
        );
      },
      { isolationLevel: "ReadCommitted" }
    );
  }

  /**
   * Consumes the one-time grant only while the complete private graph is
   * locked and current. The same transaction creates the sole scoped
   * connector execution. It does not expose credential material, enqueue a
   * connector worker or call the provider.
   */
  private async consumePending(
    prepared: RankExecutionGrantAttempt
  ): Promise<RankExecutionGrantAttemptResult> {
    return this.prisma.$transaction(
      async (transaction) => {
        const locked = await lockedExecutionGraph(
          transaction,
          prepared.jobId,
          prepared.jobItemId,
          false
        );
        if (
          locked.identity.workspaceId !== prepared.workspaceId ||
          locked.identity.projectId !== prepared.projectId ||
          !(await lockRankExecutionGrantAttempt(
            transaction,
            locked.identity,
            prepared.jobItemId,
            prepared.id
          ))
        ) {
          throw failure("LOCAL_STATE_INVALID", false);
        }
        const current =
          await transaction.rankExecutionGrantAttempt.findUnique({
            where: { id: prepared.id }
          });
        if (!current) throw failure("LOCAL_STATE_INVALID", false);
        if (current.status !== "GRANTED_PENDING_CONSUME") {
          return attemptResult(current);
        }
        if (
          current.decisionSnapshot === null ||
          current.expiresAt === null
        ) {
          throw failure("LOCAL_STATE_INVALID", false);
        }

        const clock = await databaseClock(transaction);
        if (clock.getTime() >= current.expiresAt.getTime()) {
          return attemptResult(
            await transaction.rankExecutionGrantAttempt.update({
              where: { id: current.id },
              data: {
                status: "EXPIRED",
                terminalAt: clock
              }
            })
          );
        }

        let rebuilt: BuiltRankExecutionGrantRequest;
        try {
          rebuilt = requestForLockedGraph(
            { ...locked, databaseNow: clock },
            current.executionAttempt,
            this.config
          );
          assertExactAttempt(current, rebuilt);
          const transition = rankExecutionGrantDecisionTransition(
            rebuilt.request,
            current.decisionSnapshot,
            clock
          );
          if (
            transition.status !== "GRANTED_PENDING_CONSUME" ||
            transition.expiresAt.getTime() !==
              current.expiresAt.getTime()
          ) {
            throw failure("LOCAL_STATE_INVALID", false);
          }
        } catch {
          return attemptResult(
            await rejectLocal(
              transaction,
              current,
              clock,
              internalRankExecutionGrantDecision(
                current.decisionSnapshot
              ) as Extract<
                InternalRankExecutionGrantDecisionV1,
                { readonly status: "GRANTED" }
              >,
              current.expiresAt
            )
          );
        }

        const evidence = rebuilt.evidence;
        await transaction.rankConnectorExecution.create({
          data: {
            workspaceId: current.workspaceId,
            projectId: current.projectId,
            jobId: current.jobId,
            jobItemId: current.jobItemId,
            grantAttemptId: current.id,
            executionAttempt: current.executionAttempt,
            jobVersion: current.jobVersion,
            provider: rebuilt.request.provider,
            estimateId: evidence.estimateId,
            manifestId: evidence.manifest.id,
            manifestHash: Buffer.from(
              evidence.manifest.hash.value,
              "hex"
            ),
            manifestChunkIndex: evidence.manifest.chunkIndex,
            providerRequestIntentId:
              evidence.providerRequestIntent.id,
            providerRequestIntentHash: Buffer.from(
              evidence.providerRequestIntent.requestHash.value,
              "hex"
            ),
            providerRequestIntentChunkHash: Buffer.from(
              evidence.providerRequestIntent.manifestChunkHash.value,
              "hex"
            ),
            bindingId: evidence.binding.id,
            bindingVersion: evidence.binding.version,
            routeId: evidence.route.id,
            credentialId: evidence.credential.id,
            credentialVersion: evidence.credential.version,
            credentialMaterialVersion:
              evidence.credential.materialVersion,
            credentialValidationId:
              evidence.credential.validationId,
            credentialValidationVersion:
              evidence.credential.validationVersion,
            credentialValidationConnectorVersion:
              evidence.credential.validationConnectorVersion,
            credentialVerifiedAt: new Date(
              evidence.credential.verifiedAt
            ),
            estimateExecutionHash: Buffer.from(
              evidence.estimateExecutionHash.value,
              "hex"
            ),
            executionEvidenceHash: Buffer.from(
              rebuilt.evidenceHash.value,
              "hex"
            ),
            executionConnectorVersion:
              evidence.executionConnectorVersion,
            providerPolicyVersion: evidence.providerPolicyVersion,
            killSwitchVersion: evidence.killSwitch.version,
            authorizationExpiresAt: current.expiresAt,
            createdAt: clock,
            updatedAt: clock
          }
        });
        return attemptResult(
          await transaction.rankExecutionGrantAttempt.update({
            where: { id: current.id },
            data: {
              status: "CONSUMED",
              terminalAt: clock
            }
          })
        );
      },
      { isolationLevel: "ReadCommitted" }
    );
  }
}

export function isExpiredUnusedAuthorization(
  execution:
    | {
        readonly status: string;
        readonly authorizationExpiresAt: Date;
        readonly submitAttemptCount: number;
        readonly submitBytesStartedAt: Date | null;
        readonly providerTaskId: string | null;
      }
    | null,
  now: Date
): boolean {
  return (
    (execution?.status === "READY_TO_SUBMIT" ||
      execution?.status === "CLAIMED") &&
    execution.authorizationExpiresAt.getTime() <= now.getTime() &&
    execution.submitAttemptCount === 0 &&
    execution.submitBytesStartedAt === null &&
    execution.providerTaskId === null
  );
}

async function lockedExecutionGraph(
  transaction: Prisma.TransactionClient,
  jobId: string,
  jobItemId: string,
  requireCurrent = true
): Promise<LockedRankExecutionGraph> {
  const identity = await lockRankJobGraph(transaction, jobId);
  if (!identity || !(await lockRankJobItem(transaction, identity, jobItemId))) {
    throw failure("ITEM_NOT_FOUND", false);
  }
  const job = await transaction.job.findUnique({
    where: { id: jobId },
    include: { rankRun: { include: { estimate: true } } }
  });
  const item = await transaction.jobItem.findUnique({
    where: { id: jobItemId }
  });
  if (!job || !item) throw failure("ITEM_NOT_FOUND", false);
  const requestIntent =
    await transaction.rankProviderRequestIntent.findFirst({
      where: {
        workspaceId: identity.workspaceId,
        projectId: identity.projectId,
        jobId,
        jobItemId
      }
    });
  const graph = job as RankGrantJobGraph;
  const projectionIdentity = executionProjectionIdentity(graph, item);
  const projectionLocked = await lockRankExecutionProjection(
    transaction,
    projectionIdentity
  );
  const projection = await executionProjection(
    transaction,
    identity.workspaceId,
    identity.projectId,
    graph.rankRun?.estimate.provider as "ARSENKIN" | "XMLSTOCK" | undefined,
    graph.rankRun?.estimate.routeId ?? undefined
  );
  const databaseNow = await databaseClock(transaction);
  if (requireCurrent && !projectionLocked) {
    throw failure("LOCAL_STATE_INVALID", false, "projection_lock_failed");
  }
  if (requireCurrent) {
    validateLockedGraph(
      graph,
      item,
      requestIntent,
      projection,
      databaseNow
    );
  }
  return {
    identity,
    job: graph,
    item,
    requestIntent,
    projectionIdentity,
    projection,
    databaseNow
  };
}

function executionProjectionIdentity(
  job: RankGrantJobGraph,
  item: JobItem
): RankExecutionProjectionIdentity {
  const run = job.rankRun;
  const estimate = run?.estimate;
  if (
    !run ||
    !estimate ||
    !estimate.credentialId ||
    !estimate.credentialValidationId ||
    !estimate.bindingId ||
    !estimate.routeId ||
    job.projectId === null
  ) {
    throw failure("LOCAL_STATE_INVALID", false, "projection_identity_incomplete");
  }
  return {
    jobId: job.id,
    jobItemId: item.id,
    workspaceId: job.workspaceId,
    projectId: job.projectId,
    credentialId: estimate.credentialId,
    validationJobId: estimate.credentialValidationId,
    bindingId: estimate.bindingId,
    routeId: estimate.routeId
  };
}

function validateLockedGraph(
  job: RankGrantJobGraph,
  item: JobItem,
  requestIntent: RankProviderRequestIntent | null,
  projection: ExecutionProjection,
  databaseNow: Date
): void {
  const run = job.rankRun;
  const estimate = run?.estimate;
  const reference = rankJobItemReference(item.inputReference);
  if (
    !run ||
    !estimate ||
    job.type !== MANUAL_RANK_CHECK_JOB_TYPE ||
    job.projectId === null ||
    job.actorId === null ||
    (job.provider !== "ARSENKIN" && job.provider !== "XMLSTOCK") ||
    job.credentialMode !== "BYOK_API_KEY" ||
    !grantableJobState(job) ||
    item.workspaceId !== job.workspaceId ||
    item.projectId !== job.projectId ||
    item.jobId !== job.id ||
    item.status !== "QUEUED" ||
    item.providerRequestId !== null ||
    item.outputReference !== null ||
    item.actualCostMicro !== null ||
    item.error !== null ||
    item.attempt !== 0 ||
    item.retryAt !== null ||
    run.workspaceId !== job.workspaceId ||
    run.projectId !== job.projectId ||
    run.sealState !== "SEALED" ||
    run.manifestHashSchema !== "rank-manifest@1" ||
    run.manifestId === null ||
    run.manifestHash === null ||
    run.manifestPairCount === null ||
    run.manifestChunkCount === null ||
    run.manifestChunkSize === null ||
    run.manifestPairCount !== estimate.keywordCount ||
    !validRankRunManifestShape(
      run.manifestPairCount,
      run.manifestChunkCount,
      run.manifestChunkSize,
      estimate.providerPolicyVersion
    ) ||
    run.finalizationStatus !== null ||
    run.finalizedAt !== null ||
    run.cancelRequestedBy !== null ||
    reference.manifestId !== run.manifestId ||
    reference.chunkIndex !== item.sequence ||
    reference.chunkIndex >= run.manifestChunkCount ||
    estimate.id !== run.estimateId ||
    estimate.workspaceId !== job.workspaceId ||
    estimate.projectId !== job.projectId ||
    estimate.provider !== job.provider ||
    estimate.credentialMode !== "BYOK_API_KEY" ||
    estimate.executionSnapshotHash === null ||
    run.projectStatus !== "ACTIVE" ||
    run.projectVersion !== estimate.projectVersion ||
    !bytesEqual(
      rankEstimateProjectDomainHash(run.projectDomain),
      estimate.projectDomainHash
    )
  ) {
    throw failure("LOCAL_STATE_INVALID", false, "locked_graph_base_invariant");
  }

  const authorization = rankJobAuthorizationSnapshot(job.inputSnapshot);
  if (
    authorization.estimateId !== estimate.id ||
    authorization.projectVersion !== run.projectVersion
  ) {
    throw failure("LOCAL_STATE_INVALID", false, "authorization_snapshot_mismatch");
  }
  const verified = verifiedRankEstimate(estimate);
  if (!verified.execution || verified.summary.status !== "READY") {
    throw failure("LOCAL_STATE_INVALID", false, "estimate_not_ready");
  }
  try {
    validateProviderRequestIntent(
      job,
      item,
      run,
      estimate,
      verified.execution,
      reference.chunkIndex,
      requestIntent
    );
  } catch {
    throw failure("LOCAL_STATE_INVALID", false, "request_intent_mismatch");
  }
  try {
    assertExecutionProjectionCurrent(
      estimate,
      credentialSnapshot(projection),
      databaseNow,
      { allowNewerValidation: true }
    );
  } catch {
    throw failure("LOCAL_STATE_INVALID", false, "execution_projection_changed");
  }

  const binding = projection.binding;
  const route = projection.route;
  if (
    !binding ||
    !binding.enabled ||
    binding.capability !== "SERP_RANK_TRACKING" ||
    !route ||
    !Number.isSafeInteger(route.position) ||
    route.position < 0 ||
    route.sourceKind !== "WORKSPACE_CREDENTIAL" ||
    route.credential.provider !== job.provider ||
    route.credential.mode !== "BYOK_API_KEY" ||
    route.credential.status !== "ACTIVE" ||
    route.credential.deletedAt !== null
  ) {
    throw failure("LOCAL_STATE_INVALID", false, "routing_projection_invalid");
  }
}

function requestForLockedGraph(
  locked: LockedRankExecutionGraph,
  executionAttempt: number,
  config: AppConfig
): BuiltRankExecutionGrantRequest {
  try {
    validateLockedGraph(
      locked.job,
      locked.item,
      locked.requestIntent,
      locked.projection,
      locked.databaseNow
    );
    const run = locked.job.rankRun;
    if (!run) {
      throw failure("LOCAL_STATE_INVALID", false, "rank_run_missing");
    }
    const estimate = run.estimate;
    const authorization = rankJobAuthorizationSnapshot(
      locked.job.inputSnapshot
    );
    const reference = rankJobItemReference(locked.item.inputReference);
    const current = credentialSnapshot(locked.projection);
    const requestIntent = locked.requestIntent;
    if (!requestIntent) {
      throw failure("LOCAL_STATE_INVALID", false, "request_intent_missing");
    }
    const facts = requestFacts(
      locked.job,
      locked.item,
      run,
      estimate,
      authorization,
      reference.chunkIndex,
      requestIntent,
      current,
      executionAttempt,
      config
    );
    return buildRankExecutionGrantRequest(facts);
  } catch (error) {
    if (error instanceof RankExecutionGrantAttemptError) throw error;
    throw failure("LOCAL_STATE_INVALID", false, "grant_request_build_failed");
  }
}

function requestFacts(
  job: RankGrantJobGraph,
  item: JobItem,
  run: RankJobRun,
  estimate: RankEstimate,
  authorization: ReturnType<typeof rankJobAuthorizationSnapshot>,
  manifestChunkIndex: number,
  requestIntent: RankProviderRequestIntent,
  current: CredentialSnapshot,
  executionAttempt: number,
  config: AppConfig
): RankExecutionGrantRequestFacts {
  if (
    job.projectId === null ||
    job.actorId === null ||
    run.manifestId === null ||
    run.manifestHash === null ||
    estimate.executionSnapshotHash === null ||
    current.bindingId === undefined ||
    current.bindingVersion === undefined ||
    current.routeId === undefined ||
    current.credentialId === undefined ||
    current.credentialVersion === undefined ||
    current.credentialMaterialVersion === undefined ||
    current.validationId === undefined ||
    current.validationVersion === undefined ||
    current.validationConnectorVersion === undefined ||
    current.verifiedAt === undefined
  ) {
    throw failure("LOCAL_STATE_INVALID", false);
  }
  return {
    provider: job.provider as "ARSENKIN" | "XMLSTOCK",
    workspaceId: job.workspaceId,
    projectId: job.projectId,
    actorId: job.actorId,
    membershipId: authorization.membershipId,
    membershipVersion: authorization.membershipVersion,
    projectVersion: authorization.projectVersion,
    projectDomainHash: rankEstimateProjectDomainHash(run.projectDomain),
    jobId: job.id,
    jobItemId: item.id,
    jobVersion: job.version,
    executionAttempt,
    estimateId: estimate.id,
    manifestId: run.manifestId,
    manifestHash: run.manifestHash,
    manifestChunkIndex,
    providerRequestIntentId: requestIntent.id,
    providerRequestIntentHash: requestIntent.requestHash,
    manifestChunkHash: requestIntent.manifestChunkHash,
    bindingId: current.bindingId,
    bindingVersion: current.bindingVersion,
    routeId: current.routeId,
    credentialId: current.credentialId,
    credentialVersion: current.credentialVersion,
    credentialMaterialVersion: current.credentialMaterialVersion,
    credentialValidationId: current.validationId,
    credentialValidationVersion: current.validationVersion,
    credentialValidationConnectorVersion:
      current.validationConnectorVersion,
    credentialVerifiedAt: current.verifiedAt,
    estimateExecutionHash: estimate.executionSnapshotHash,
    providerPolicyVersion: estimate.providerPolicyVersion,
    killSwitchVersion: rankExecutionKillSwitchVersion(
      job.provider as "ARSENKIN" | "XMLSTOCK",
      config.rankExecution.killSwitchVersion
    )
  };
}

function validateProviderRequestIntent(
  job: RankGrantJobGraph,
  item: JobItem,
  run: RankJobRun,
  estimate: RankEstimate,
  execution: RankProviderRequestIntentBinding["execution"],
  manifestChunkIndex: number,
  requestIntent: RankProviderRequestIntent | null
): void {
  if (
    !requestIntent ||
    job.projectId === null ||
    job.actorId === null ||
    run.manifestId === null ||
    run.manifestHash === null ||
    run.manifestPairCount === null
  ) {
    throw failure("LOCAL_STATE_INVALID", false);
  }
  const binding: RankProviderRequestIntentBinding = {
    workspaceId: job.workspaceId,
    projectId: job.projectId,
    actorId: job.actorId,
    jobId: job.id,
    jobItemId: item.id,
    estimateId: estimate.id,
    projectDomain: run.projectDomain,
    projectVersion: run.projectVersion,
    execution,
    manifestId: run.manifestId,
    manifestHash: run.manifestHash,
    manifestPairCount: run.manifestPairCount,
    manifestChunkIndex,
    executionConnectorVersion: rankExecutionConnectorVersion(
      job.provider as "ARSENKIN" | "XMLSTOCK"
    ),
    providerPolicyVersion: estimate.providerPolicyVersion
  };
  try {
    storedRankProviderRequestIntent(requestIntent, binding);
  } catch {
    throw failure("LOCAL_STATE_INVALID", false);
  }
}

function grantableJobState(job: Job): boolean {
  return (
    (job.status === "QUEUED" && job.stage === "WAITING_FOR_QUEUE") ||
    (job.status === "RUNNING" &&
      job.stage === "WAITING_EXECUTION_GRANT")
  );
}

function validRankRunManifestShape(
  pairCount: number | null,
  chunkCount: number | null,
  chunkSize: number | null,
  policyVersion: string
): boolean {
  if (
    pairCount === null ||
    chunkCount === null ||
    chunkSize === null ||
    !Number.isSafeInteger(pairCount) ||
    !Number.isSafeInteger(chunkCount) ||
    !Number.isSafeInteger(chunkSize)
  ) {
    return false;
  }
  if (policyVersion === legacyRankProviderPolicyVersion) {
    return (
      pairCount >= 1 &&
      pairCount <= legacyRankProviderKeywordLimit &&
      chunkSize === legacyRankManifestChunkSize &&
      chunkCount ===
        Math.ceil(pairCount / legacyRankManifestChunkSize)
    );
  }
  if (policyVersion === xmlStockRankProviderPolicyVersion) {
    return (
      pairCount >= 1 &&
      pairCount <= rankProviderKeywordLimit &&
      chunkSize === xmlStockRankManifestChunkSize &&
      chunkCount === pairCount
    );
  }
  return (
    policyVersion === currentRankProviderPolicyVersion &&
    pairCount >= 1 &&
    pairCount <= rankProviderKeywordLimit &&
    chunkSize === rankManifestSingleTaskChunkSize &&
    chunkCount === 1
  );
}

function assertExactAttempt(
  attempt: RankExecutionGrantAttempt,
  built: BuiltRankExecutionGrantRequest
): void {
  const stored = storedRankExecutionGrantRequest(
    attempt.requestSnapshot
  );
  const hashes = rankExecutionGrantHashes(built.request);
  if (
    canonicalizeJson(stored) !== canonicalizeJson(built.request) ||
    attempt.jobVersion !== built.request.jobVersion ||
    attempt.executionAttempt !== built.request.executionAttempt ||
    attempt.idempotencyKey !==
      rankExecutionGrantAttemptIdempotencyKey(
        attempt.jobItemId,
        attempt.executionAttempt
      ) ||
    !bytesEqual(attempt.requestHash, hashes.requestHash) ||
    !bytesEqual(attempt.scopeHash, hashes.scopeHash) ||
    !bytesEqual(
      attempt.executionEvidenceHash,
      Buffer.from(built.evidenceHash.value, "hex")
    )
  ) {
    throw failure("LOCAL_STATE_INVALID", false);
  }
}

async function rejectLocal(
  transaction: Prisma.TransactionClient,
  attempt: RankExecutionGrantAttempt,
  clock: Date,
  decision?: Extract<
    InternalRankExecutionGrantDecisionV1,
    { readonly status: "GRANTED" }
  >,
  expiresAt?: Date
): Promise<RankExecutionGrantAttempt> {
  if (decision && !expiresAt) {
    throw failure("LOCAL_STATE_INVALID", false);
  }
  return transaction.rankExecutionGrantAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "REJECTED_LOCAL",
      ...(decision
        ? {
            decisionSnapshot: rankExecutionGrantDecisionJson(decision),
            decidedAt: new Date(decision.decidedAt),
            expiresAt: expiresAt as Date
          }
        : {}),
      terminalAt: clock
    }
  });
}

async function databaseClock(
  transaction: Prisma.TransactionClient
): Promise<Date> {
  return readDatabaseClock(
    transaction,
    "Unable to read Jobs database clock"
  );
}

function attemptResult(
  attempt: RankExecutionGrantAttempt
): RankExecutionGrantAttemptResult {
  const decision =
    attempt.decisionSnapshot === null
      ? undefined
      : internalRankExecutionGrantDecision(attempt.decisionSnapshot);
  return {
    id: attempt.id,
    workspaceId: attempt.workspaceId,
    projectId: attempt.projectId,
    jobId: attempt.jobId,
    jobItemId: attempt.jobItemId,
    executionAttempt: attempt.executionAttempt,
    status: attempt.status,
    ...(attempt.expiresAt
      ? { expiresAt: attempt.expiresAt.toISOString() }
      : {}),
    ...(decision ? { decision } : {})
  };
}

function assertSettledDecision(
  attempt: RankExecutionGrantAttempt,
  value: InternalRankExecutionGrantDecisionV1
): void {
  if (attempt.decisionSnapshot === null) return;
  const stored = internalRankExecutionGrantDecision(
    attempt.decisionSnapshot
  );
  const incoming = internalRankExecutionGrantDecision(value);
  if (canonicalizeJson(stored) !== canonicalizeJson(incoming)) {
    throw failure("LOCAL_STATE_INVALID", false);
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return (
    first.length === second.length &&
    first.length === 32 &&
    timingSafeEqual(first, second)
  );
}

function failure(
  code: RankExecutionGrantAttemptErrorCode,
  retryable: boolean,
  detail?: string
): RankExecutionGrantAttemptError {
  return new RankExecutionGrantAttemptError(code, retryable, detail);
}
