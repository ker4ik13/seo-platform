import {
  connectorRoutingScopes,
  rankRuntimeDiagnosticStates,
  rankProviderKeywordLimit,
  rankJobFailureCodes,
  redactRankJobSummary,
  type RankJobFailureCode,
  type RankJobResultSummary,
  type RankJobSummary,
  type RankRuntimeDiagnostics
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const MAX_FIRST_SLICE_PAIR_COUNT = BigInt(rankProviderKeywordLimit);
const MAX_RANK_DECIMAL_DIGITS = String(rankProviderKeywordLimit).length;
const FAILURE_CODES = new Set<string>(rankJobFailureCodes);
const RESPONSE_FIELDS = [
  "id",
  "workspaceId",
  "projectId",
  "actorId",
  "trackingContextId",
  "type",
  "provider",
  "purpose",
  "saveProjectPosition",
  "searchEngine",
  "searchSource",
  "depth",
  "routingScope",
  "connectorAttempts",
  "operation",
  "credentialMode",
  "status",
  "stage",
  "progress",
  "platformChargeMicro",
  "billingCurrency",
  "createdAt",
  "queuedAt",
  "startedAt",
  "finishedAt",
  "result",
  "failure"
] as const;

/**
 * Validates the public-safe Jobs projection at the Platform API trust
 * boundary. Private provider, credential and keyword fields are rejected as
 * unknown rather than silently discarded.
 */
export function scopedRankJobSummary(
  value: unknown,
  workspaceId: string,
  projectId: string,
  expectedJobId?: string,
  expectedBillingCurrency?: string
): RankJobSummary {
  const input = exactRecord(value, RESPONSE_FIELDS);
  const id = uuid(input.id);
  const responseWorkspaceId = uuid(input.workspaceId);
  const responseProjectId = uuid(input.projectId);
  const trackingContextId = uuid(input.trackingContextId);
  const actorId = input.actorId === undefined ? undefined : uuid(input.actorId);
  const progress = rankJobProgress(input.progress);
  const billingCurrency = currency(input.billingCurrency);
  const createdAt = timestamp(input.createdAt);
  const queuedAt = optionalTimestamp(input.queuedAt);
  const startedAt = optionalTimestamp(input.startedAt);
  const finishedAt = optionalTimestamp(input.finishedAt);
  const result =
    input.result === undefined
      ? undefined
      : rankJobResult(input.result, progress);
  const failure =
    input.failure === undefined
      ? undefined
      : rankJobFailure(input.failure);
  const provider =
    input.provider === "ARSENKIN" || input.provider === "XMLSTOCK"
      ? input.provider
      : undefined;
  const purpose =
    input.purpose === undefined
      ? undefined
      : member(
          input.purpose,
          ["POSITION_TRACKING", "COMPETITOR_SERP"] as const
        );
  const saveProjectPosition =
    input.saveProjectPosition === undefined
      ? undefined
      : typeof input.saveProjectPosition === "boolean"
        ? input.saveProjectPosition
        : null;
  const searchEngine =
    input.searchEngine === undefined
      ? undefined
      : member(input.searchEngine, ["GOOGLE", "YANDEX"] as const);
  const searchSource =
    input.searchSource === undefined
      ? undefined
      : member(input.searchSource, ["SEARCH_API", "LIVE"] as const);
  const depth =
    input.depth === undefined
      ? undefined
      : numericMember(input.depth, [30, 50, 100] as const);
  const routing = routeSummary(input.routingScope, input.connectorAttempts);
  const credentialMode =
    input.credentialMode === "BYOK_API_KEY" ||
    input.credentialMode === "PLATFORM_PAID"
      ? input.credentialMode
      : undefined;
  const platformChargeMicro =
    typeof input.platformChargeMicro === "string" &&
    DECIMAL_PATTERN.test(input.platformChargeMicro)
      ? input.platformChargeMicro
      : undefined;

  if (
    responseWorkspaceId !== workspaceId ||
    responseProjectId !== projectId ||
    (expectedJobId !== undefined && id !== expectedJobId) ||
    (expectedBillingCurrency !== undefined &&
      billingCurrency !== expectedBillingCurrency) ||
    input.type !== "MANUAL_RANK_CHECK" ||
    provider === undefined ||
    input.operation !== "POSITIONS" ||
    credentialMode === undefined ||
    saveProjectPosition === null ||
    (purpose === undefined) !== (saveProjectPosition === undefined) ||
    platformChargeMicro === undefined ||
    (credentialMode === "BYOK_API_KEY" &&
      platformChargeMicro !== "0") ||
    (credentialMode === "PLATFORM_PAID" &&
      platformChargeMicro === "0") ||
    (searchSource !== undefined && searchEngine === undefined) ||
    (searchEngine === "GOOGLE" && searchSource === "SEARCH_API") ||
    typeof input.status !== "string" ||
    typeof input.stage !== "string"
  ) {
    throw invalidResponse();
  }

  assertTimeline(createdAt, queuedAt, startedAt, finishedAt);

  const base = {
    id,
    workspaceId: responseWorkspaceId,
    projectId: responseProjectId,
    ...(actorId ? { actorId } : {}),
    trackingContextId,
    type: "MANUAL_RANK_CHECK",
    provider,
    ...(purpose === undefined
      ? {}
      : { purpose, saveProjectPosition: saveProjectPosition as boolean }),
    ...(searchEngine === undefined ? {} : { searchEngine }),
    ...(searchSource === undefined ? {} : { searchSource }),
    ...(depth === undefined ? {} : { depth }),
    ...routing,
    operation: "POSITIONS",
    credentialMode,
    progress,
    platformChargeMicro,
    billingCurrency,
    createdAt
  } as const;

  try {
    switch (input.status) {
      case "PREPARING":
        requireLifecycle(
          input.stage === "PREPARING_SCOPE" &&
            progress.current === "0" &&
            queuedAt === undefined &&
            startedAt === undefined &&
            finishedAt === undefined &&
            result === undefined &&
            failure === undefined
        );
        return redactRankJobSummary({
          ...base,
          status: "PREPARING",
          stage: "PREPARING_SCOPE"
        });
      case "QUEUED":
        requireLifecycle(
          input.stage === "WAITING_FOR_QUEUE" &&
            progress.current === "0" &&
            queuedAt !== undefined &&
            startedAt === undefined &&
            finishedAt === undefined &&
            result === undefined &&
            failure === undefined
        );
        return redactRankJobSummary({
          ...base,
          status: "QUEUED",
          stage: "WAITING_FOR_QUEUE",
          queuedAt
        });
      case "RUNNING":
        requireLifecycle(
          isActiveStage(input.stage) &&
            queuedAt !== undefined &&
            startedAt !== undefined &&
            finishedAt === undefined &&
            result === undefined &&
            failure === undefined
        );
        return redactRankJobSummary({
          ...base,
          status: "RUNNING",
          stage: input.stage,
          queuedAt,
          startedAt
        });
      case "CANCEL_REQUESTED":
        requireLifecycle(
          isCancellableStage(input.stage) &&
            hasCancellableStageTimestamps(
              input.stage,
              queuedAt,
              startedAt
            ) &&
            finishedAt === undefined &&
            result === undefined &&
            failure === undefined
        );
        return redactRankJobSummary({
          ...base,
          status: "CANCEL_REQUESTED",
          stage: input.stage,
          ...(queuedAt === undefined ? {} : { queuedAt }),
          ...(startedAt === undefined ? {} : { startedAt })
        });
      case "CANCELLED":
        requireLifecycle(
          input.stage === "FINISHED" &&
            finishedAt !== undefined &&
            failure === undefined
        );
        return redactRankJobSummary({
          ...base,
          status: "CANCELLED",
          stage: "FINISHED",
          ...(result === undefined ? {} : { result }),
          ...executionTimes(queuedAt, startedAt),
          finishedAt
        });
      case "COMPLETED":
        requireLifecycle(
          input.stage === "FINISHED" &&
            finishedAt !== undefined &&
            result !== undefined &&
            failure === undefined &&
            result.persistedCount === result.pairCount &&
            result.failedCount === "0" &&
            result.submitOutcomeUnknownCount === "0"
        );
        return redactRankJobSummary({
          ...base,
          status: "COMPLETED",
          stage: "FINISHED",
          result,
          ...executionTimes(queuedAt, startedAt),
          finishedAt
        });
      case "PARTIALLY_COMPLETED":
        requireLifecycle(
          input.stage === "FINISHED" &&
            finishedAt !== undefined &&
            result !== undefined &&
            failure === undefined &&
            BigInt(result.persistedCount) > 0n &&
            BigInt(result.persistedCount) < BigInt(result.pairCount)
        );
        return redactRankJobSummary({
          ...base,
          status: "PARTIALLY_COMPLETED",
          stage: "FINISHED",
          result,
          ...executionTimes(queuedAt, startedAt),
          finishedAt
        });
      case "FAILED":
        requireLifecycle(
          input.stage === "FINISHED" &&
            finishedAt !== undefined &&
            failure !== undefined &&
            failure.code !== "SUBMIT_OUTCOME_UNKNOWN"
        );
        return redactRankJobSummary({
          ...base,
          status: "FAILED",
          stage: "FINISHED",
          ...(result === undefined ? {} : { result }),
          failure: {
            code: failure.code as Exclude<
              RankJobFailureCode,
              "SUBMIT_OUTCOME_UNKNOWN"
            >
          },
          ...executionTimes(queuedAt, startedAt),
          finishedAt
        });
      case "ACTION_REQUIRED":
        requireLifecycle(
          input.stage === "SUBMIT_OUTCOME_UNKNOWN" &&
            finishedAt !== undefined &&
            result !== undefined &&
            failure?.code === "SUBMIT_OUTCOME_UNKNOWN" &&
            result.persistedCount === "0" &&
            result.foundCount === "0" &&
            result.notFoundCount === "0" &&
            result.failedCount === "0" &&
            result.submitOutcomeUnknownCount === result.pairCount
        );
        return redactRankJobSummary({
          ...base,
          status: "ACTION_REQUIRED",
          stage: "SUBMIT_OUTCOME_UNKNOWN",
          result,
          failure: { code: "SUBMIT_OUTCOME_UNKNOWN" },
          ...executionTimes(queuedAt, startedAt),
          finishedAt
        });
      default:
        throw invalidResponse();
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw invalidResponse();
  }
}

export function scopedRankRuntimeDiagnostics(
  value: unknown,
  expectedJobId: string
): RankRuntimeDiagnostics {
  const input = requiredExactRecord(value, [
    "jobId",
    "generatedAt",
    "policy",
    "totals",
    "entries"
  ]);
  const jobId = uuid(input.jobId);
  if (jobId !== expectedJobId) throw invalidResponse();
  const policyInput = requiredExactRecord(input.policy, [
    "product",
    "concurrency",
    "requestsPerSecond"
  ]);
  const product = member(policyInput.product, [
    "YANDEX_LIVE",
    "GOOGLE_LIVE",
    "YANDEX_SEARCH_API"
  ] as const);
  const concurrency = boundedInteger(policyInput.concurrency, 1, 50);
  const requestsPerSecond = boundedInteger(
    policyInput.requestsPerSecond,
    1,
    100
  );
  const totalsInput = requiredExactRecord(input.totals, [
    "total",
    "prepared",
    "active",
    "waitingProvider",
    "completed",
    "failed"
  ]);
  const total = boundedInteger(
    totalsInput.total,
    0,
    rankProviderKeywordLimit
  );
  const prepared = boundedInteger(totalsInput.prepared, 0, total);
  const active = boundedInteger(totalsInput.active, 0, prepared);
  const waitingProvider = boundedInteger(
    totalsInput.waitingProvider,
    0,
    prepared
  );
  const completed = boundedInteger(totalsInput.completed, 0, prepared);
  const failed = boundedInteger(totalsInput.failed, 0, prepared);
  if (!Array.isArray(input.entries) || input.entries.length > 250) {
    throw invalidResponse();
  }
  if (
    completed + failed > prepared ||
    (total === 0 && input.entries.length > 0)
  ) {
    throw invalidResponse();
  }
  const seenSequences = new Set<number>();
  const entries = input.entries.map((candidate) => {
    const entry = exactRecord(candidate, [
      "sequence",
      "keyword",
      "lane",
      "state",
      "executionAttempt",
      "submitAttempts",
      "pollAttempts",
      "completedPages",
      "totalPages",
      "active",
      "nextActionAt",
      "errorCode",
      "updatedAt"
    ]);
    const sequence = boundedInteger(
      entry.sequence,
      0,
      Math.max(0, total - 1)
    );
    if (seenSequences.has(sequence)) throw invalidResponse();
    seenSequences.add(sequence);
    const totalPages = boundedInteger(entry.totalPages, 1, 10);
    const completedPages = boundedInteger(
      entry.completedPages,
      0,
      totalPages
    );
    const nextActionAt = optionalTimestamp(entry.nextActionAt);
    const errorCode = entry.errorCode;
    if (
      typeof entry.active !== "boolean" ||
      (errorCode !== undefined &&
        (typeof errorCode !== "string" ||
          !/^[A-Z0-9_]{1,100}$/u.test(errorCode)))
    ) {
      throw invalidResponse();
    }
    return {
      sequence,
      keyword: boundedKeyword(entry.keyword),
      lane: boundedInteger(entry.lane, 1, concurrency),
      state: member(entry.state, rankRuntimeDiagnosticStates),
      executionAttempt: boundedInteger(entry.executionAttempt, 1, 1000),
      submitAttempts: boundedInteger(entry.submitAttempts, 0, 1000),
      pollAttempts: boundedInteger(entry.pollAttempts, 0, 10000),
      completedPages,
      totalPages,
      active: entry.active,
      ...(nextActionAt ? { nextActionAt } : {}),
      ...(typeof errorCode === "string" ? { errorCode } : {}),
      updatedAt: timestamp(entry.updatedAt)
    };
  });
  return {
    jobId,
    generatedAt: timestamp(input.generatedAt),
    policy: { product, concurrency, requestsPerSecond },
    totals: {
      total,
      prepared,
      active,
      waitingProvider,
      completed,
      failed
    },
    entries
  };
}

function boundedKeyword(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 1_000 ||
    Array.from(value).length > 500 ||
    new TextEncoder().encode(value).byteLength > 2_000
  ) {
    throw invalidResponse();
  }
  return value;
}

function routeSummary(
  routingScope: unknown,
  attempts: unknown
): Pick<RankJobSummary, "routingScope" | "connectorAttempts"> {
  if (routingScope === undefined && attempts === undefined) return {};
  if (routingScope === undefined || !Array.isArray(attempts) || attempts.length < 1 || attempts.length > 8) {
    throw invalidResponse();
  }
  return {
    routingScope: member(routingScope, connectorRoutingScopes),
    connectorAttempts: attempts.map((candidate, index) => {
      const input = exactRecord(candidate, [
        "sequence",
        "provider",
        "routingScope",
        "outcome",
        "reasonCode",
        "occurredAt"
      ]);
      if (input.sequence !== index + 1) throw invalidResponse();
      const reasonCode = input.reasonCode;
      if (
        reasonCode !== undefined &&
        (typeof reasonCode !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(reasonCode))
      ) throw invalidResponse();
      return {
        sequence: index + 1,
        provider: member(input.provider, ["XMLSTOCK", "ARSENKIN", "KEYS_SO"] as const),
        routingScope: member(input.routingScope, connectorRoutingScopes),
        outcome: member(input.outcome, ["SELECTED", "SUCCEEDED", "FALLBACK", "FAILED"] as const),
        ...(reasonCode === undefined ? {} : { reasonCode }),
        occurredAt: timestamp(input.occurredAt)
      };
    })
  };
}

function rankJobProgress(value: unknown): RankJobSummary["progress"] {
  const input = requiredExactRecord(value, [
    "current",
    "total",
    "unit"
  ]);
  const current = decimal(input.current);
  const total = decimal(input.total);
  if (
    input.unit !== "KEYWORD" ||
    BigInt(total) < 1n ||
    BigInt(total) > MAX_FIRST_SLICE_PAIR_COUNT ||
    BigInt(current) > BigInt(total)
  ) {
    throw invalidResponse();
  }
  return { current, total, unit: "KEYWORD" };
}

function rankJobResult(
  value: unknown,
  progress: RankJobSummary["progress"]
): RankJobResultSummary {
  const input = requiredExactRecord(value, [
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
    submitOutcomeUnknownCount: decimal(
      input.submitOutcomeUnknownCount
    )
  };
  const pairCount = BigInt(result.pairCount);
  const persistedCount = BigInt(result.persistedCount);
  const failedCount = BigInt(result.failedCount);
  const unknownCount = BigInt(result.submitOutcomeUnknownCount);
  if (
    result.pairCount !== progress.total ||
    result.persistedCount !== progress.current ||
    persistedCount !==
      BigInt(result.foundCount) + BigInt(result.notFoundCount) ||
    persistedCount > pairCount ||
    failedCount > pairCount ||
    unknownCount > pairCount ||
    persistedCount + failedCount + unknownCount > pairCount
  ) {
    throw invalidResponse();
  }
  return result;
}

function rankJobFailure(
  value: unknown
): { readonly code: RankJobFailureCode } {
  const input = requiredExactRecord(value, ["code"]);
  if (typeof input.code !== "string" || !FAILURE_CODES.has(input.code)) {
    throw invalidResponse();
  }
  return { code: input.code as RankJobFailureCode };
}

const ACTIVE_STAGES = new Set<string>([
  "WAITING_EXECUTION_GRANT",
  "READY_TO_SUBMIT",
  "SUBMITTING",
  "WAITING_PROVIDER",
  "FETCHING_RESULT",
  "PERSISTING_RESULT",
  "FINALIZING"
]);

function isActiveStage(
  value: string
): value is Extract<
  RankJobSummary,
  { status: "RUNNING" }
>["stage"] {
  return ACTIVE_STAGES.has(value);
}

function isCancellableStage(
  value: string
): value is Extract<
  RankJobSummary,
  { status: "CANCEL_REQUESTED" }
>["stage"] {
  return (
    value === "PREPARING_SCOPE" ||
    value === "WAITING_FOR_QUEUE" ||
    isActiveStage(value)
  );
}

function hasCancellableStageTimestamps(
  stage: Extract<
    RankJobSummary,
    { status: "CANCEL_REQUESTED" }
  >["stage"],
  queuedAt: string | undefined,
  startedAt: string | undefined
): boolean {
  if (stage === "PREPARING_SCOPE") {
    return queuedAt === undefined && startedAt === undefined;
  }
  if (stage === "WAITING_FOR_QUEUE") {
    return queuedAt !== undefined && startedAt === undefined;
  }
  return queuedAt !== undefined && startedAt !== undefined;
}

function executionTimes(
  queuedAt: string | undefined,
  startedAt: string | undefined
): { readonly queuedAt?: string; readonly startedAt?: string } {
  return {
    ...(queuedAt === undefined ? {} : { queuedAt }),
    ...(startedAt === undefined ? {} : { startedAt })
  };
}

function assertTimeline(
  createdAt: string,
  queuedAt: string | undefined,
  startedAt: string | undefined,
  finishedAt: string | undefined
): void {
  const created = Date.parse(createdAt);
  const queued = queuedAt === undefined ? undefined : Date.parse(queuedAt);
  const started =
    startedAt === undefined ? undefined : Date.parse(startedAt);
  const finished =
    finishedAt === undefined ? undefined : Date.parse(finishedAt);
  if (
    (queued !== undefined && queued < created) ||
    (started !== undefined && started < created) ||
    (finished !== undefined && finished < created) ||
    (queued !== undefined && started !== undefined && started < queued) ||
    (queued !== undefined && finished !== undefined && finished < queued) ||
    (started !== undefined &&
      finished !== undefined &&
      finished < started)
  ) {
    throw invalidResponse();
  }
}

function requireLifecycle(condition: boolean): asserts condition {
  if (!condition) throw invalidResponse();
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw invalidResponse();
  }
  return value.toLowerCase();
}

function currency(value: unknown): string {
  if (typeof value !== "string" || !CURRENCY_PATTERN.test(value)) {
    throw invalidResponse();
  }
  return value;
}

function decimal(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_RANK_DECIMAL_DIGITS ||
    !DECIMAL_PATTERN.test(value)
  ) {
    throw invalidResponse();
  }
  return value;
}

function optionalTimestamp(value: unknown): string | undefined {
  return value === undefined ? undefined : timestamp(value);
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") throw invalidResponse();
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) {
    throw invalidResponse();
  }
  return value;
}

function member<const Values extends readonly string[]>(
  value: unknown,
  values: Values
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw invalidResponse();
  }
  return value as Values[number];
}

function numericMember<const Values extends readonly number[]>(
  value: unknown,
  values: Values
): Values[number] {
  if (typeof value !== "number" || !values.includes(value)) {
    throw invalidResponse();
  }
  return value as Values[number];
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw invalidResponse();
  }
  return value;
}

function requiredExactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  const input = exactRecord(value, fields);
  if (
    Object.keys(input).length !== fields.length ||
    fields.some((field) => !(field in input))
  ) {
    throw invalidResponse();
  }
  return input;
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse();
  }
  const input = value as Readonly<Record<string, unknown>>;
  const allowed = new Set(fields);
  if (Object.keys(input).some((field) => !allowed.has(field))) {
    throw invalidResponse();
  }
  return input;
}

function invalidResponse(): DomainError {
  return new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Jobs service returned an invalid manual rank Job",
    retryable: true
  });
}
