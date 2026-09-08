import { timingSafeEqual } from "node:crypto";
import {
  redactRankJobSummary,
  rankSearchSourceFromProviderMappingVersion,
  rankJobFailureCodes,
  type InternalCreateRankRunInput,
  type InternalRetryRankJobInput,
  type InternalRankExecutionParameters,
  type ConnectorOperationAttemptSummary,
  type ConnectorRoutingScope,
  type RankEstimate,
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
const RETRY_REQUEST_HASH_SCHEMA = "rank-run-retry-request@1";
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
      estimateId: input.estimateId,
      confirmedPlatformChargeMicro:
        input.confirmedPlatformChargeMicro
    }),
    "hex"
  );
}

export function rankRetryIdempotencyScope(parentJobId: string): string {
  return `rank-run-retry:${parentJobId}`;
}

export function rankRetryRequestHash(
  input: InternalRetryRankJobInput
): Buffer {
  return Buffer.from(
    canonicalJsonSha256(RETRY_REQUEST_HASH_SCHEMA, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: input.actorId,
      parentJobId: input.jobId
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
  trackingContextId: string,
  execution: Pick<
    InternalRankExecutionParameters,
    | "purpose"
    | "saveProjectPosition"
    | "searchEngine"
    | "depth"
    | "providerMappingVersion"
  > & Partial<Pick<
    InternalRankExecutionParameters,
    "countryCode" | "regionCode" | "language" | "device"
  >>,
  estimate?: Pick<RankEstimate, "routingScope" | "connectorAttempts">
): Prisma.InputJsonValue {
  const searchSource = rankSearchSourceFromProviderMappingVersion(
    execution.searchEngine,
    execution.providerMappingVersion
  );
  const geography = execution.countryCode &&
    execution.language &&
    execution.device
    ? {
        countryCode: execution.countryCode,
        regionCode: execution.regionCode ?? execution.countryCode,
        language: execution.language,
        device: execution.device
      }
    : {};
  return json({
    schemaVersion: RANK_JOB_INPUT_SCHEMA,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    trackingContextId,
    ...(execution.purpose ? { purpose: execution.purpose } : {}),
    ...(execution.saveProjectPosition === undefined
      ? {}
      : { saveProjectPosition: execution.saveProjectPosition }),
    searchEngine: execution.searchEngine,
    ...geography,
    ...(searchSource ? { searchSource } : {}),
    depth: execution.depth,
    ...(estimate?.routingScope ? { routingScope: estimate.routingScope } : {}),
    ...(estimate?.connectorAttempts
      ? { connectorAttempts: [...estimate.connectorAttempts] }
      : {})
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
    (stored.provider !== "ARSENKIN" && stored.provider !== "XMLSTOCK") ||
    (stored.credentialMode !== "BYOK_API_KEY" &&
      stored.credentialMode !== "PLATFORM_PAID") ||
    stored.currency === null ||
    !/^[A-Z]{3}$/u.test(stored.currency) ||
    stored.progressTotal === null ||
    stored.estimatedCostMicro === null ||
    stored.progressCurrent < 0n ||
    stored.progressTotal < 1n ||
    stored.progressCurrent > stored.progressTotal
  ) {
    invalid();
  }
  if (
    stored.estimatedCostMicro < 0n ||
    (stored.credentialMode === "BYOK_API_KEY" &&
      stored.estimatedCostMicro !== 0n) ||
    (stored.credentialMode === "PLATFORM_PAID" &&
      (stored.estimatedCostMicro < 1n ||
        stored.estimatedCostMicro % 10_000n !== 0n))
  ) {
    invalid();
  }
  const base = {
    id: stored.id,
    workspaceId: stored.workspaceId,
    projectId: stored.projectId,
    ...(stored.actorId ? { actorId: stored.actorId } : {}),
    trackingContextId: run.trackingContextId,
    type: "MANUAL_RANK_CHECK",
    provider: stored.provider,
    ...rankScopeSummary(
      stored.scopeSnapshot,
      stored.status,
      run.manifestCommand
    ),
    operation: "POSITIONS",
    credentialMode: stored.credentialMode,
    progress: {
      current: stored.progressCurrent.toString(),
      total: stored.progressTotal.toString(),
      unit: "KEYWORD"
    },
    platformChargeMicro: stored.estimatedCostMicro.toString(),
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
        BigInt(result.persistedCount) >= BigInt(result.pairCount) ||
        BigInt(result.submitOutcomeUnknownCount) < 1n
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

interface RankExecutionPresentation {
  readonly searchEngine?: "GOOGLE" | "YANDEX";
  readonly searchSource?: "SEARCH_API" | "LIVE";
  readonly countryCode?: string;
  readonly regionCode?: string;
  readonly language?: string;
  readonly device?: "DESKTOP" | "MOBILE";
  readonly depth?: 30 | 50 | 100;
  readonly purpose?: "POSITION_TRACKING" | "COMPETITOR_SERP";
  readonly saveProjectPosition?: boolean;
}

function rankScopeSummary(
  value: unknown,
  status: string,
  manifestCommand: unknown
): RankExecutionPresentation & {
  readonly routingScope?: ConnectorRoutingScope;
  readonly connectorAttempts?: readonly ConnectorOperationAttemptSummary[];
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const input = value as Readonly<Record<string, unknown>>;
  const presentation = rankExecutionPresentation(input, manifestCommand);
  if (input.routingScope === undefined && input.connectorAttempts === undefined) return presentation;
  if (
    input.routingScope !== "WORKSPACE_DEFAULT" &&
    input.routingScope !== "PROJECT_OVERRIDE" &&
    input.routingScope !== "WORKSPACE_FALLBACK"
  ) invalid();
  if (!Array.isArray(input.connectorAttempts) || input.connectorAttempts.length < 1 || input.connectorAttempts.length > 8) invalid();
  const storedAttempts = input.connectorAttempts;
  const terminalSuccess = status === "COMPLETED" || status === "PARTIALLY_COMPLETED";
  const terminalFailure = status === "FAILED" || status === "ACTION_REQUIRED";
  const connectorAttempts = storedAttempts.map((candidate, index) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) invalid();
    const attempt = candidate as Readonly<Record<string, unknown>>;
    if (
      attempt.sequence !== index + 1 ||
      (attempt.provider !== "XMLSTOCK" && attempt.provider !== "ARSENKIN" && attempt.provider !== "KEYS_SO") ||
      (attempt.routingScope !== "WORKSPACE_DEFAULT" && attempt.routingScope !== "PROJECT_OVERRIDE" && attempt.routingScope !== "WORKSPACE_FALLBACK") ||
      (attempt.outcome !== "SELECTED" && attempt.outcome !== "SUCCEEDED" && attempt.outcome !== "FALLBACK" && attempt.outcome !== "FAILED") ||
      typeof attempt.occurredAt !== "string" ||
      Number.isNaN(Date.parse(attempt.occurredAt)) ||
      (attempt.reasonCode !== undefined && (typeof attempt.reasonCode !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(attempt.reasonCode)))
    ) invalid();
    return {
      sequence: index + 1,
      provider: attempt.provider,
      routingScope: attempt.routingScope,
      outcome:
        terminalSuccess && attempt.outcome === "SELECTED"
          ? "SUCCEEDED" as const
          : terminalFailure &&
              index === storedAttempts.length - 1 &&
              attempt.outcome === "SELECTED"
            ? "FAILED" as const
          : attempt.outcome,
      ...(attempt.reasonCode === undefined ? {} : { reasonCode: attempt.reasonCode }),
      occurredAt: new Date(attempt.occurredAt).toISOString()
    } as ConnectorOperationAttemptSummary;
  });
  return { ...presentation, routingScope: input.routingScope, connectorAttempts };
}

function rankExecutionPresentation(
  input: Readonly<Record<string, unknown>>,
  manifestCommand: unknown
): RankExecutionPresentation {
  const searchEngine = input.searchEngine;
  const searchSource = input.searchSource;
  const depth = input.depth;
  const purpose = input.purpose;
  const saveProjectPosition = input.saveProjectPosition;
  const manifestPresentation = manifestExecutionPresentation(manifestCommand);
  const inputGeography = [
    input.countryCode,
    input.regionCode,
    input.language,
    input.device
  ];
  const hasInputGeography = inputGeography.some(value => value !== undefined);
  if (hasInputGeography && inputGeography.some(value => value === undefined)) {
    invalid();
  }
  if (
    searchEngine === undefined &&
    searchSource === undefined &&
    depth === undefined &&
    purpose === undefined &&
    saveProjectPosition === undefined &&
    !hasInputGeography
  ) {
    return manifestPresentation;
  }
  const countryCode = hasInputGeography
    ? input.countryCode
    : manifestPresentation.countryCode;
  const regionCode = hasInputGeography
    ? input.regionCode
    : manifestPresentation.regionCode;
  const language = hasInputGeography
    ? input.language
    : manifestPresentation.language;
  const device = hasInputGeography
    ? input.device
    : manifestPresentation.device;
  const geography = [countryCode, regionCode, language, device];
  if (
    (searchEngine !== "GOOGLE" && searchEngine !== "YANDEX") ||
    (depth !== 30 && depth !== 50 && depth !== 100) ||
    (searchSource !== undefined &&
      searchSource !== "SEARCH_API" &&
      searchSource !== "LIVE") ||
    (searchEngine === "GOOGLE" && searchSource === "SEARCH_API") ||
    (purpose !== undefined &&
      purpose !== "POSITION_TRACKING" &&
      purpose !== "COMPETITOR_SERP") ||
    (saveProjectPosition !== undefined &&
      typeof saveProjectPosition !== "boolean") ||
    (geography.some(value => value !== undefined) &&
      geography.some(value => value === undefined)) ||
    (countryCode !== undefined &&
      (typeof countryCode !== "string" || !/^[A-Z]{2}$/u.test(countryCode))) ||
    (regionCode !== undefined &&
      (typeof regionCode !== "string" ||
        regionCode.length < 1 ||
        regionCode.length > 100)) ||
    (language !== undefined &&
      (typeof language !== "string" ||
        language.length < 2 ||
        language.length > 16)) ||
    (device !== undefined && device !== "DESKTOP" && device !== "MOBILE")
  ) {
    invalid();
  }
  return {
    searchEngine,
    ...(searchSource
      ? { searchSource }
      : manifestPresentation.searchEngine === searchEngine &&
          manifestPresentation.depth === depth &&
          manifestPresentation.searchSource
        ? { searchSource: manifestPresentation.searchSource }
        : {}),
    ...(typeof countryCode === "string" ? { countryCode } : {}),
    ...(typeof regionCode === "string" ? { regionCode } : {}),
    ...(typeof language === "string" ? { language } : {}),
    ...(device === "DESKTOP" || device === "MOBILE" ? { device } : {}),
    depth,
    ...(purpose === undefined
      ? manifestPresentation.purpose
        ? { purpose: manifestPresentation.purpose }
        : {}
      : { purpose }),
    ...(saveProjectPosition === undefined
      ? manifestPresentation.saveProjectPosition === undefined
        ? {}
        : { saveProjectPosition: manifestPresentation.saveProjectPosition }
      : { saveProjectPosition })
  };
}

function manifestExecutionPresentation(
  value: unknown
): RankExecutionPresentation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const execution = (value as Readonly<Record<string, unknown>>).execution;
  if (
    typeof execution !== "object" ||
    execution === null ||
    Array.isArray(execution)
  ) {
    return {};
  }
  const stored = execution as Readonly<Record<string, unknown>>;
  const searchEngine = stored.searchEngine;
  const depth = stored.depth;
  const purpose = stored.purpose;
  const saveProjectPosition = stored.saveProjectPosition;
  const countryCode = stored.countryCode;
  const regionCode = stored.regionCode ?? countryCode;
  const language = stored.language;
  const device = stored.device;
  if (
    (searchEngine !== "GOOGLE" && searchEngine !== "YANDEX") ||
    (depth !== 30 && depth !== 50 && depth !== 100) ||
    (purpose !== undefined &&
      purpose !== "POSITION_TRACKING" &&
      purpose !== "COMPETITOR_SERP") ||
    (saveProjectPosition !== undefined &&
      typeof saveProjectPosition !== "boolean") ||
    typeof countryCode !== "string" ||
    !/^[A-Z]{2}$/u.test(countryCode) ||
    typeof regionCode !== "string" ||
    regionCode.length < 1 ||
    regionCode.length > 100 ||
    typeof language !== "string" ||
    language.length < 2 ||
    language.length > 16 ||
    (device !== "DESKTOP" && device !== "MOBILE")
  ) {
    return {};
  }
  const providerMappingVersion = stored.providerMappingVersion;
  const searchSource =
    typeof providerMappingVersion === "string"
      ? rankSearchSourceFromProviderMappingVersion(
          searchEngine,
          providerMappingVersion
        )
      : undefined;
  return {
    searchEngine,
    countryCode,
    regionCode,
    language,
    device,
    ...(purpose === undefined ? {} : { purpose }),
    ...(saveProjectPosition === undefined
      ? {}
      : { saveProjectPosition }),
    ...(searchSource ? { searchSource } : {}),
    depth
  };
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
    BigInt(result.persistedCount) +
        BigInt(result.failedCount) +
        BigInt(result.submitOutcomeUnknownCount) !==
      BigInt(result.pairCount) ||
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
