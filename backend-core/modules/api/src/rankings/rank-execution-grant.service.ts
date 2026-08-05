import { createHash, timingSafeEqual } from "node:crypto";
import {
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import {
  internalRankExecutionGrantDecision,
  rankExecutionGrantDecisionSchemaVersion,
  rankExecutionGrantRequestHashDomain,
  rankExecutionGrantRequestHashPreimage,
  rankExecutionGrantSchemaVersion,
  rankExecutionGrantScopeHashDomain,
  rankExecutionGrantScopeHashPreimage,
  rankEstimateProjectDomainHashPreimage,
  redactInternalRankExecutionGrantDecision,
  type InternalIssueRankExecutionGrantInputV1,
  type InternalRankExecutionGrantDecisionV1,
  type RankExecutionGrantDenialReason,
  type RankManifestHash
} from "@seo-platform/contracts";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import {
  Prisma,
  type RankExecutionGrantReceipt
} from "../generated/prisma/client.js";
import {
  hasEffectiveProjectPermission,
  type ProjectAccessLevel
} from "../authorization/permissions.js";
import { DomainError } from "../common/domain-error.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  RANK_EXECUTION_GRANT_POLICY,
  type RankExecutionGrantPolicy,
  type RankExecutionGrantPolicyDecision
} from "./rank-execution-grant.policy.js";

const GRANT_TTL_MILLISECONDS = 30_000;
const TRANSACTION_ATTEMPTS = 3;
const IDEMPOTENCY_SCOPE_PREFIX = "rank-execution-grant:";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;

type GrantTransaction = Prisma.TransactionClient;

export interface RankExecutionGrantIssueResult {
  readonly decision: InternalRankExecutionGrantDecisionV1;
  readonly created: boolean;
}

type RankExecutionGrantAuthorization =
  | {
      readonly status: "DENIED";
      readonly reason: RankExecutionGrantDenialReason;
    }
  | {
      readonly status: "GRANTED";
      readonly quotaReservationId: string;
    };

@Injectable()
export class RankExecutionGrantService {
  public constructor(
    private readonly prisma: PrismaService,
    @Inject(RANK_EXECUTION_GRANT_POLICY)
    private readonly policy: RankExecutionGrantPolicy
  ) {}

  public async issue(
    input: InternalIssueRankExecutionGrantInputV1,
    idempotencyKey: string,
    correlationId: string
  ): Promise<RankExecutionGrantIssueResult> {
    const requestHash = contractHash(
      rankExecutionGrantRequestHashDomain,
      rankExecutionGrantRequestHashPreimage(input)
    );
    const scopeHash = contractHash(
      rankExecutionGrantScopeHashDomain,
      rankExecutionGrantScopeHashPreimage(input)
    );
    const idempotencyScope = `${IDEMPOTENCY_SCOPE_PREFIX}${input.projectId}`;
    const replay = await findIdempotent(
      this.prisma,
      input.workspaceId,
      idempotencyScope,
      idempotencyKey
    );
    if (replay) {
      return {
        decision: replayDecision(replay, requestHash),
        created: false
      };
    }

    for (let attempt = 1; attempt <= TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            const transactionReplay = await findIdempotent(
              transaction,
              input.workspaceId,
              idempotencyScope,
              idempotencyKey
            );
            if (transactionReplay) {
              return {
                decision: replayDecision(transactionReplay, requestHash),
                created: false
              };
            }

            const authorization = await authorizeGrant(
              transaction,
              input,
              this.policy
            );
            const [clock] = await transaction.$queryRaw<
              readonly {
                readonly grantId: string;
                readonly decidedAt: Date;
              }[]
            >`
              SELECT
                uuidv7()::text AS "grantId",
                clock_timestamp() AS "decidedAt"
            `;
            if (
              !clock ||
              !(clock.decidedAt instanceof Date) ||
              Number.isNaN(clock.decidedAt.getTime())
            ) {
              throw new Error("Unable to allocate rank execution grant");
            }

            const decision = decisionFor(
              clock.grantId,
              clock.decidedAt,
              requestHash,
              scopeHash,
              authorization
            );
            await transaction.rankExecutionGrantReceipt.create({
              data: {
                id: clock.grantId,
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                actorId: input.actorId,
                membershipId: input.membership.id,
                jobId: input.jobId,
                jobItemId: input.jobItemId,
                executionAttempt: input.executionAttempt,
                projectVersion: input.project.version,
                membershipVersion: input.membership.version,
                policyVersion: input.policyVersion,
                idempotencyScope,
                idempotencyKey,
                requestHash: databaseBytes(requestHash),
                scopeHash: databaseBytes(scopeHash),
                requestSnapshot: rankExecutionGrantRequestHashPreimage(
                  input
                ) as unknown as Prisma.InputJsonValue,
                responseSnapshot:
                  decision as unknown as Prisma.InputJsonValue,
                decision: decision.status,
                denialReason:
                  decision.status === "DENIED"
                    ? decision.reason
                    : null,
                decidedAt: clock.decidedAt,
                expiresAt:
                  decision.status === "GRANTED"
                    ? new Date(
                        clock.decidedAt.getTime() +
                          GRANT_TTL_MILLISECONDS
                      )
                    : null,
                quotaReservationId:
                  authorization.status === "GRANTED"
                    ? authorization.quotaReservationId
                    : null,
                correlationId: requiredCorrelationId(correlationId)
              }
            });
            return { decision, created: true };
          },
          { isolationLevel: "Serializable" }
        );
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return this.resolveUniqueRace(
            input,
            idempotencyScope,
            idempotencyKey,
            requestHash
          );
        }
        if (isSerializationFailure(error) && attempt < TRANSACTION_ATTEMPTS) {
          continue;
        }
        if (isSerializationFailure(error)) {
          throw new ServiceUnavailableException(
            "Rank execution grant changed concurrently"
          );
        }
        throw error;
      }
    }
    throw new ServiceUnavailableException(
      "Rank execution grant could not be decided"
    );
  }

  private async resolveUniqueRace(
    input: InternalIssueRankExecutionGrantInputV1,
    idempotencyScope: string,
    idempotencyKey: string,
    requestHash: Buffer
  ): Promise<RankExecutionGrantIssueResult> {
    const replay = await findIdempotent(
      this.prisma,
      input.workspaceId,
      idempotencyScope,
      idempotencyKey
    );
    if (replay) {
      return {
        decision: replayDecision(replay, requestHash),
        created: false
      };
    }
    const equivalent =
      await this.prisma.rankExecutionGrantReceipt.findUnique({
        where: {
          workspaceId_jobItemId_executionAttempt: {
            workspaceId: input.workspaceId,
            jobItemId: input.jobItemId,
            executionAttempt: input.executionAttempt
          }
        }
      });
    if (equivalent) throw idempotencyConflict();
    throw new ServiceUnavailableException(
      "Rank execution grant race could not be resolved"
    );
  }
}

async function authorizeGrant(
  transaction: GrantTransaction,
  input: InternalIssueRankExecutionGrantInputV1,
  policy: RankExecutionGrantPolicy
): Promise<RankExecutionGrantAuthorization> {
  await lockAuthorizationRows(transaction, input);
  const [workspace, project, membership] = await Promise.all([
    transaction.workspace.findUnique({
      where: { id: input.workspaceId },
      select: { id: true, status: true }
    }),
    transaction.project.findFirst({
      where: { id: input.projectId, workspaceId: input.workspaceId },
      select: {
        id: true,
        status: true,
        version: true,
        domain: true
      }
    }),
    transaction.workspaceMember.findFirst({
      where: {
        id: input.membership.id,
        workspaceId: input.workspaceId,
        userId: input.actorId
      },
      select: {
        id: true,
        status: true,
        version: true,
        roleCode: true,
        allProjects: true,
        user: { select: { status: true } },
        projectAccesses: {
          where: { projectId: input.projectId },
          select: { level: true },
          take: 1
        }
      }
    })
  ]);

  if (!workspace || workspace.status !== "ACTIVE") {
    return denied("WORKSPACE_NOT_ACTIVE");
  }
  if (!project || project.status !== "ACTIVE") {
    return denied("PROJECT_NOT_ACTIVE");
  }
  if (
    project.version !== input.project.version ||
    !hashValuesEqual(
      projectDomainHash(project.domain),
      input.project.domainHash.value
    )
  ) {
    return denied("PROJECT_VERSION_CHANGED");
  }
  if (
    !membership ||
    membership.status !== "ACTIVE" ||
    membership.user.status !== "ACTIVE"
  ) {
    return denied("MEMBERSHIP_NOT_ACTIVE");
  }
  if (membership.version !== input.membership.version) {
    return denied("MEMBERSHIP_VERSION_CHANGED");
  }
  const projectAccess = membership.projectAccesses[0]?.level as
    | ProjectAccessLevel
    | undefined;
  if (
    (!membership.allProjects && !projectAccess) ||
    !hasEffectiveProjectPermission(
      membership.roleCode,
      projectAccess,
      "ranking.run"
    )
  ) {
    return denied("RUN_PERMISSION_DENIED");
  }

  const policyDecision = await policy.evaluate(transaction, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorId: input.actorId,
    jobId: input.jobId,
    jobItemId: input.jobItemId,
    executionAttempt: input.executionAttempt,
    policyVersion: input.policyVersion,
    usageIntent: { meter: "RANK_PROVIDER_TASK", quantity: 1 }
  });
  return policyAuthorization(policyDecision);
}

async function lockAuthorizationRows(
  transaction: GrantTransaction,
  input: InternalIssueRankExecutionGrantInputV1
): Promise<void> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "workspaces"
    WHERE "id" = ${input.workspaceId}::uuid
    FOR UPDATE
  `;
  await transaction.$queryRaw`
    SELECT "id"
    FROM "projects"
    WHERE "id" = ${input.projectId}::uuid
      AND "workspace_id" = ${input.workspaceId}::uuid
    FOR UPDATE
  `;
  await transaction.$queryRaw`
    SELECT "id"
    FROM "users"
    WHERE "id" = ${input.actorId}::uuid
    FOR UPDATE
  `;
  await transaction.$queryRaw`
    SELECT "id"
    FROM "workspace_members"
    WHERE "id" = ${input.membership.id}::uuid
      AND "workspace_id" = ${input.workspaceId}::uuid
      AND "user_id" = ${input.actorId}::uuid
    FOR UPDATE
  `;
  await transaction.$queryRaw`
    SELECT "id"
    FROM "project_member_access"
    WHERE "project_id" = ${input.projectId}::uuid
      AND "member_id" = ${input.membership.id}::uuid
    FOR UPDATE
  `;
}

function policyAuthorization(
  decision: RankExecutionGrantPolicyDecision
): RankExecutionGrantAuthorization {
  if (
    decision.entitlement === "NOT_AVAILABLE" &&
    decision.quota === "NOT_AVAILABLE" &&
    decision.quotaReservationId === undefined
  ) {
    return denied("ENTITLEMENT_NOT_AVAILABLE");
  }
  if (
    decision.entitlement === "DENIED" &&
    decision.quota === "NOT_AVAILABLE" &&
    decision.quotaReservationId === undefined
  ) {
    return denied("ENTITLEMENT_DENIED");
  }
  if (
    decision.entitlement === "ALLOWED" &&
    decision.quota === "NOT_AVAILABLE" &&
    decision.quotaReservationId === undefined
  ) {
    return denied("QUOTA_NOT_AVAILABLE");
  }
  if (
    decision.entitlement === "ALLOWED" &&
    decision.quota === "EXHAUSTED" &&
    decision.quotaReservationId === undefined
  ) {
    return denied("QUOTA_EXHAUSTED");
  }
  if (
    decision.entitlement === "ALLOWED" &&
    decision.quota === "AVAILABLE" &&
    typeof decision.quotaReservationId === "string" &&
    UUID_PATTERN.test(decision.quotaReservationId)
  ) {
    return {
      status: "GRANTED",
      quotaReservationId: decision.quotaReservationId.toLowerCase()
    };
  }
  throw new Error("Invalid rank execution grant policy decision");
}

function denied(
  reason: RankExecutionGrantDenialReason
): RankExecutionGrantAuthorization {
  return { status: "DENIED", reason };
}

function decisionFor(
  grantId: string,
  decidedAt: Date,
  requestHash: Buffer,
  scopeHash: Buffer,
  authorization: RankExecutionGrantAuthorization
): InternalRankExecutionGrantDecisionV1 {
  const requestHashContract = hashContract(requestHash);
  const decidedAtIso = decidedAt.toISOString();
  if (authorization.status === "DENIED") {
    return redactInternalRankExecutionGrantDecision({
      schemaVersion: rankExecutionGrantDecisionSchemaVersion,
      status: "DENIED",
      requestHash: requestHashContract,
      decidedAt: decidedAtIso,
      reason: authorization.reason
    });
  }
  const expiresAt = new Date(
    decidedAt.getTime() + GRANT_TTL_MILLISECONDS
  ).toISOString();
  return redactInternalRankExecutionGrantDecision({
    schemaVersion: rankExecutionGrantDecisionSchemaVersion,
    status: "GRANTED",
    requestHash: requestHashContract,
    decidedAt: decidedAtIso,
    grant: {
      schemaVersion: rankExecutionGrantSchemaVersion,
      id: grantId,
      requestHash: requestHashContract,
      scopeHash: hashContract(scopeHash),
      issuer: "PLATFORM_API",
      issuedAt: decidedAtIso,
      expiresAt
    }
  });
}

function replayDecision(
  receipt: RankExecutionGrantReceipt,
  requestHash: Buffer
): InternalRankExecutionGrantDecisionV1 {
  if (!hashBytesEqual(receipt.requestHash, requestHash)) {
    throw idempotencyConflict();
  }
  const stored = internalRankExecutionGrantDecision(
    receipt.responseSnapshot
  );
  const expectedRequestHash = hashContract(requestHash);
  if (
    stored.requestHash.value !== expectedRequestHash.value ||
    stored.status !== receipt.decision ||
    stored.decidedAt !== receipt.decidedAt.toISOString() ||
    (stored.status === "DENIED" &&
      (stored.reason !== receipt.denialReason ||
        receipt.quotaReservationId !== null)) ||
    (stored.status === "GRANTED" &&
      (stored.grant.id !== receipt.id ||
        stored.grant.scopeHash.value !==
          Buffer.from(receipt.scopeHash).toString("hex") ||
        stored.grant.expiresAt !== receipt.expiresAt?.toISOString() ||
        receipt.quotaReservationId === null))
  ) {
    throw new Error("Stored rank execution grant receipt is invalid");
  }
  return stored;
}

function findIdempotent(
  transaction: Pick<Prisma.TransactionClient, "rankExecutionGrantReceipt">,
  workspaceId: string,
  idempotencyScope: string,
  idempotencyKey: string
): Promise<RankExecutionGrantReceipt | null> {
  return transaction.rankExecutionGrantReceipt.findUnique({
    where: {
      workspaceId_idempotencyScope_idempotencyKey: {
        workspaceId,
        idempotencyScope,
        idempotencyKey
      }
    }
  });
}

function contractHash(domain: string, value: unknown): Buffer {
  return Buffer.from(canonicalJsonSha256(domain, value), "hex");
}

function hashContract(value: Buffer): RankManifestHash {
  return { algorithm: "SHA_256", value: value.toString("hex") };
}

function projectDomainHash(domain: string): string {
  return createHash("sha256")
    .update(rankEstimateProjectDomainHashPreimage(domain), "utf8")
    .digest("hex");
}

function hashValuesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function hashBytesEqual(left: Uint8Array, right: Buffer): boolean {
  const candidate = Buffer.from(left);
  return (
    candidate.length === right.length &&
    timingSafeEqual(candidate, right)
  );
}

function requiredCorrelationId(value: string): string {
  if (!CORRELATION_ID_PATTERN.test(value)) {
    throw new Error("Invalid rank execution grant correlation ID");
  }
  return value;
}

function idempotencyConflict(): DomainError {
  return new DomainError({
    statusCode: 409,
    code: "IDEMPOTENCY_CONFLICT",
    message:
      "Rank execution grant idempotency key or item attempt is already used"
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return hasDatabaseFailureCode(error, new Set(["P2002"]));
}

function isSerializationFailure(error: unknown): boolean {
  return hasDatabaseFailureCode(
    error,
    new Set(["P2034", "40P01", "40001"])
  );
}

function hasDatabaseFailureCode(
  error: unknown,
  codes: ReadonlySet<string>,
  depth = 0
): boolean {
  if (depth > 4 || typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as {
    readonly code?: unknown;
    readonly originalCode?: unknown;
    readonly message?: unknown;
    readonly cause?: unknown;
    readonly meta?: unknown;
    readonly driverAdapterError?: unknown;
  };
  if (
    (typeof candidate.code === "string" && codes.has(candidate.code)) ||
    (typeof candidate.originalCode === "string" &&
      codes.has(candidate.originalCode))
  ) {
    return true;
  }
  if (
    codes.size > 1 &&
    typeof candidate.message === "string" &&
    /\b(?:40P01|40001|deadlock|serialization failure)\b/iu.test(
      candidate.message
    )
  ) {
    return true;
  }
  return (
    hasDatabaseFailureCode(candidate.cause, codes, depth + 1) ||
    hasDatabaseFailureCode(candidate.meta, codes, depth + 1) ||
    hasDatabaseFailureCode(
      candidate.driverAdapterError,
      codes,
      depth + 1
    )
  );
}

function databaseBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}
