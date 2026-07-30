import { timingSafeEqual } from "node:crypto";
import {
  redactRankJobSummary,
  rankJobFailureCodes,
  type InternalCreateRankRunInput,
  type RankJobFailureCode,
  type RankJobResultSummary,
  type RankJobSummary
} from "@seo-platform/contracts";
import {
  canonicalJsonSha256,
  canonicalizeJson
} from "@seo-platform/contracts/canonical-json";
import type {
  Job,
  Prisma,
  RankJobRun
} from "../generated/prisma/client.js";

export const MANUAL_RANK_CHECK_JOB_TYPE = "MANUAL_RANK_CHECK";
export const RANK_JOB_INPUT_SCHEMA = "manual-rank-check@1";
const REQUEST_HASH_SCHEMA = "rank-run-request@1";
const FAILURE_CODES = new Set<string>(rankJobFailureCodes);

export type StoredRankJob = Job & {
  readonly rankRun: RankJobRun | null;
};

export interface RankJobAuthorizationSnapshot {
  readonly estimateId: string;
  readonly membershipId: string;
  readonly membershipVersion: number;
  readonly projectVersion: number;
}

export function rankRunIdempotencyScope(projectId: string): string {
  return `rank-run:${projectId}`;
}

export function rankRunDeduplicationKey(estimateId: string): string {
  return `manual-rank-estimate:${estimateId}`;
}

export function rankRunRequestHash(
  input: InternalCreateRankRunInput
): Buffer {
  return Buffer.from(
    canonicalJsonSha256(REQUEST_HASH_SCHEMA, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: input.actorId,
      estimateId: input.estimateId
    }),
    "hex"
  );
}

export function rankRunRequestMatches(
  stored: Uint8Array | null,
  expected: Uint8Array
): boolean {
  if (!stored) return false;
  const left = Buffer.from(stored);
  const right = Buffer.from(expected);
  return (
    left.length === right.length &&
    left.length === 32 &&
    timingSafeEqual(left, right)
  );
}

export function rankJobInputJson(
  input: InternalCreateRankRunInput
): Prisma.InputJsonValue {
  return json({
    schemaVersion: RANK_JOB_INPUT_SCHEMA,
    estimateId: input.estimateId,
    membershipId: input.access.membershipId,
    membershipVersion: input.access.membershipVersion,
    projectVersion: input.project.version
  });
}

export function rankJobScopeJson(
  input: InternalCreateRankRunInput,
  trackingContextId: string
): Prisma.InputJsonValue {
  return json({
    schemaVersion: RANK_JOB_INPUT_SCHEMA,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    trackingContextId
  });
}

export function rankJobAuthorizationSnapshot(
  value: unknown
): RankJobAuthorizationSnapshot {
  const input = exactRecord(value, [
    "schemaVersion",
    "estimateId",
    "membershipId",
    "membershipVersion",
    "projectVersion"
  ]);
  if (
    input.schemaVersion !== RANK_JOB_INPUT_SCHEMA ||
    !Number.isSafeInteger(input.membershipVersion) ||
    Number(input.membershipVersion) < 1 ||
    !Number.isSafeInteger(input.projectVersion) ||
    Number(input.projectVersion) < 1
  ) {
    invalid();
  }
  return {
    estimateId: storedUuid(input.estimateId),
    membershipId: storedUuid(input.membershipId),
    membershipVersion: Number(input.membershipVersion),
    projectVersion: Number(input.projectVersion)
  };
}

export function rankJobFailureJson(
  code: RankJobFailureCode
): Prisma.InputJsonValue {
  return json({ code });
}

export function rankJobResultJson(
  result: RankJobResultSummary
): Prisma.InputJsonValue {
  return json(result);
}

export function toRankJobSummary(stored: StoredRankJob): RankJobSummary {
  const run = stored.rankRun;
  if (
    !run ||
    stored.type !== MANUAL_RANK_CHECK_JOB_TYPE ||
    stored.workspaceId !== run.workspaceId ||
    stored.projectId !== run.projectId ||
    stored.projectId === null ||
    stored.provider !== "ARSENKIN" ||
    stored.credentialMode !== "BYOK_API_KEY" ||
    stored.currency === null ||
    !/^[A-Z]{3}$/u.test(stored.currency) ||
    stored.progressTotal === null ||
    stored.progressCurrent < 0n ||
    stored.progressTotal < 1n ||
    stored.progressCurrent > stored.progressTotal
  ) {
    invalid();
  }
  const base = {
    id: stored.id,
    workspaceId: stored.workspaceId,
    projectId: stored.projectId,
    trackingContextId: run.trackingContextId,
    type: "MANUAL_RANK_CHECK",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    credentialMode: "BYOK_API_KEY",
    progress: {
      current: stored.progressCurrent.toString(),
      total: stored.progressTotal.toString(),
      unit: "KEYWORD"
    },
    platformChargeMicro: "0",
    billingCurrency: stored.currency,
    createdAt: timestamp(stored.createdAt)
  } as const;

  switch (stored.status) {
    case "PREPARING":
      return redactRankJobSummary({
        ...base,
        status: "PREPARING",
        stage: exactStage(stored.stage, "PREPARING_SCOPE")
      });
    case "QUEUED":
      return redactRankJobSummary({
        ...base,
        status: "QUEUED",
        stage: exactStage(stored.stage, "WAITING_FOR_QUEUE"),
        queuedAt: requiredTimestamp(stored.queuedAt)
      });
    case "RUNNING":
      return redactRankJobSummary({
        ...base,
        status: "RUNNING",
        stage: runningStage(stored.stage),
        queuedAt: requiredTimestamp(stored.queuedAt),
        startedAt: requiredTimestamp(stored.startedAt)
      });
    case "CANCEL_REQUESTED":
      return redactRankJobSummary({
        ...base,
        status: "CANCEL_REQUESTED",
        stage: cancellableStage(stored.stage),
        ...(stored.queuedAt ? { queuedAt: timestamp(stored.queuedAt) } : {}),
        ...(stored.startedAt
          ? { startedAt: timestamp(stored.startedAt) }
          : {})
      });
    case "CANCELLED":
      return redactRankJobSummary({
        ...base,
        status: "CANCELLED",
        stage: exactStage(stored.stage, "FINISHED"),
        ...(stored.resultSummary === null
          ? {}
          : {
              result: resultSummary(
                stored.resultSummary,
                stored.progressTotal,
                stored.progressCurrent
              )
            }),
        ...(stored.queuedAt ? { queuedAt: timestamp(stored.queuedAt) } : {}),
        ...(stored.startedAt
          ? { startedAt: timestamp(stored.startedAt) }
          : {}),
        finishedAt: requiredTimestamp(stored.finishedAt)
      });
    case "COMPLETED":
    case "PARTIALLY_COMPLETED":
      return redactRankJobSummary({
        ...base,
        status: stored.status,
        stage: exactStage(stored.stage, "FINISHED"),
        result: resultSummary(
          stored.resultSummary,
          stored.progressTotal,
          stored.progressCurrent
        ),
        ...(stored.queuedAt ? { queuedAt: timestamp(stored.queuedAt) } : {}),
        ...(stored.startedAt
          ? { startedAt: timestamp(stored.startedAt) }
          : {}),
        finishedAt: requiredTimestamp(stored.finishedAt)
      });
    case "FAILED_FINAL":
    case "EXPIRED": {
      const code = failureCode(stored.errorSummary);
      if (code === "SUBMIT_OUTCOME_UNKNOWN") invalid();
      return redactRankJobSummary({
        ...base,
        status: "FAILED",
        stage: exactStage(stored.stage, "FINISHED"),
        ...(stored.resultSummary === null
          ? {}
          : {
              result: resultSummary(
                stored.resultSummary,
                stored.progressTotal,
                stored.progressCurrent
              )
            }),
        failure: { code },
        ...(stored.queuedAt ? { queuedAt: timestamp(stored.queuedAt) } : {}),
        ...(stored.startedAt
          ? { startedAt: timestamp(stored.startedAt) }
          : {}),
        finishedAt: requiredTimestamp(stored.finishedAt)
      });
    }
    case "ACTION_REQUIRED": {
      const code = failureCode(stored.errorSummary);
      const result = resultSummary(
        stored.resultSummary,
        stored.progressTotal,
        stored.progressCurrent
      );
      if (
        code !== "SUBMIT_OUTCOME_UNKNOWN" ||
        stored.stage !== "SUBMIT_OUTCOME_UNKNOWN" ||
        result.persistedCount !== "0" ||
        result.foundCount !== "0" ||
        result.notFoundCount !== "0" ||
        result.failedCount !== "0" ||
        result.submitOutcomeUnknownCount !== result.pairCount
      ) {
        invalid();
      }
      return redactRankJobSummary({
        ...base,
        status: "ACTION_REQUIRED",
        stage: "SUBMIT_OUTCOME_UNKNOWN",
        result,
        failure: { code: "SUBMIT_OUTCOME_UNKNOWN" },
        ...(stored.queuedAt ? { queuedAt: timestamp(stored.queuedAt) } : {}),
        ...(stored.startedAt
          ? { startedAt: timestamp(stored.startedAt) }
          : {}),
        finishedAt: requiredTimestamp(stored.finishedAt)
      });
    }
    default:
      return invalid();
  }
}

function resultSummary(
  value: unknown,
  expectedPairCount: bigint,
  expectedPersistedCount: bigint
): RankJobResultSummary {
  const input = exactRecord(value, [
    "pairCount",
    "persistedCount",
    "foundCount",
    "notFoundCount",
    "failedCount",
    "submitOutcomeUnknownCount"
  ]);
  const result: RankJobResultSummary = {
    pairCount: decimal(input.pairCount),
    persistedCount: decimal(input.persistedCount),
    foundCount: decimal(input.foundCount),
    notFoundCount: decimal(input.notFoundCount),
    failedCount: decimal(input.failedCount),
    submitOutcomeUnknownCount: decimal(input.submitOutcomeUnknownCount)
  };
  if (
    BigInt(result.persistedCount) !==
      BigInt(result.foundCount) + BigInt(result.notFoundCount) ||
    BigInt(result.persistedCount) > BigInt(result.pairCount) ||
    BigInt(result.pairCount) !== expectedPairCount ||
    BigInt(result.persistedCount) !== expectedPersistedCount
  ) {
    invalid();
  }
  return result;
}

function failureCode(value: unknown): RankJobFailureCode {
  const input = exactRecord(value, ["code"]);
  if (typeof input.code !== "string" || !FAILURE_CODES.has(input.code)) {
    invalid();
  }
  return input.code as RankJobFailureCode;
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  const input = value as Readonly<Record<string, unknown>>;
  const allowed = new Set(fields);
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !allowed.has(field)) ||
    fields.some((field) => !(field in input))
  ) {
    invalid();
  }
  return input;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(canonicalizeJson(value)) as Prisma.InputJsonValue;
}

function decimal(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    invalid();
  }
  return value;
}

function storedUuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value
    )
  ) {
    invalid();
  }
  return value;
}

function exactStage<T extends string>(
  value: string | null,
  expected: T
): T {
  if (value !== expected) invalid();
  return expected;
}

function runningStage(
  value: string | null
): Extract<RankJobSummary, { status: "RUNNING" }>["stage"] {
  const stages = new Set([
    "WAITING_EXECUTION_GRANT",
    "READY_TO_SUBMIT",
    "SUBMITTING",
    "WAITING_PROVIDER",
    "FETCHING_RESULT",
    "PERSISTING_RESULT",
    "FINALIZING"
  ]);
  if (!value || !stages.has(value)) invalid();
  return value as Extract<
    RankJobSummary,
    { status: "RUNNING" }
  >["stage"];
}

function cancellableStage(
  value: string | null
): Extract<RankJobSummary, { status: "CANCEL_REQUESTED" }>["stage"] {
  if (value === "PREPARING_SCOPE" || value === "WAITING_FOR_QUEUE") {
    return value;
  }
  return runningStage(value);
}

function requiredTimestamp(value: Date | null): string {
  if (!value) invalid();
  return timestamp(value);
}

function timestamp(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) invalid();
  return value.toISOString();
}

function invalid(): never {
  throw new Error("Invalid stored manual rank Job");
}
