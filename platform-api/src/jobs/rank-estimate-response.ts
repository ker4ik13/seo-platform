import {
  rankEstimateBlockerCodes,
  type RankEstimate,
  type RankEstimateBlocker,
  type RankEstimateCredentialFreshness,
  type RankEstimateQuota,
  type RankEstimateScopeHash
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const POLICY_VERSION_PATTERN = /^[a-z0-9][a-z0-9@._-]{0,63}$/u;
const BLOCKER_CODES = new Set<string>(rankEstimateBlockerCodes);
const MAX_SCOPE_COUNT = 1_001n;
const TTL_MILLISECONDS = 5 * 60 * 1_000;

/** Maps only the redacted estimate owned by Jobs into the trusted project scope. */
export function scopedRankEstimate(
  value: unknown,
  workspaceId: string,
  projectId: string,
  trackingContextId: string
): RankEstimate {
  const estimate = exactRecord(value, [
    "id",
    "workspaceId",
    "projectId",
    "trackingContextId",
    "status",
    "provider",
    "operation",
    "credentialMode",
    "scope",
    "workload",
    "providerLimits",
    "expectedDuration",
    "platformChargeMicro",
    "billingCurrency",
    "quota",
    "credentialFreshness",
    "retention",
    "blockers",
    "executionAllowed",
    "policyVersion",
    "calculatedAt",
    "expiresAt"
  ]);
  const id = uuid(estimate.id);
  const responseWorkspaceId = uuid(estimate.workspaceId);
  const responseProjectId = uuid(estimate.projectId);
  const responseContextId = uuid(estimate.trackingContextId);
  const scope = scopeSummary(estimate.scope);
  const workload = providerWorkload(estimate.workload, scope.keywordCount);
  const blockers = blockerList(estimate.blockers);
  const calculatedAt = isoDate(estimate.calculatedAt);
  const expiresAt = isoDate(estimate.expiresAt);
  const executionAllowed = estimate.executionAllowed;
  if (
    responseWorkspaceId !== workspaceId ||
    responseProjectId !== projectId ||
    responseContextId !== trackingContextId ||
    !["READY", "BLOCKED"].includes(String(estimate.status)) ||
    estimate.provider !== "ARSENKIN" ||
    estimate.operation !== "POSITIONS" ||
    estimate.credentialMode !== "BYOK_API_KEY" ||
    exactStatus(estimate.providerLimits) !== "NOT_AVAILABLE" ||
    exactStatus(estimate.expectedDuration) !== "NOT_AVAILABLE" ||
    estimate.platformChargeMicro !== "0" ||
    typeof estimate.billingCurrency !== "string" ||
    !CURRENCY_PATTERN.test(estimate.billingCurrency) ||
    typeof executionAllowed !== "boolean" ||
    typeof estimate.policyVersion !== "string" ||
    !POLICY_VERSION_PATTERN.test(estimate.policyVersion) ||
    Date.parse(expiresAt) - Date.parse(calculatedAt) !== TTL_MILLISECONDS ||
    (estimate.status === "READY" &&
      (!executionAllowed || blockers.length !== 0)) ||
    (estimate.status === "BLOCKED" &&
      (executionAllowed || blockers.length === 0)) ||
    (scope.scopeHash.availability === "UNAVAILABLE" &&
      !blockers.some(
        ({ code }) =>
          code === "SCOPE_HASH_UNAVAILABLE" ||
          code === "KEYWORD_LIMIT_EXCEEDED"
      ))
  ) {
    throw invalidResponse();
  }

  return {
    id,
    workspaceId: responseWorkspaceId,
    projectId: responseProjectId,
    trackingContextId: responseContextId,
    status: estimate.status as RankEstimate["status"],
    provider: "ARSENKIN",
    operation: "POSITIONS",
    credentialMode: "BYOK_API_KEY",
    scope,
    workload,
    providerLimits: { status: "NOT_AVAILABLE" },
    expectedDuration: { status: "NOT_AVAILABLE" },
    platformChargeMicro: "0",
    billingCurrency: estimate.billingCurrency,
    quota: quota(estimate.quota),
    credentialFreshness: credentialFreshness(
      estimate.credentialFreshness
    ),
    retention: retention(estimate.retention),
    blockers,
    executionAllowed,
    policyVersion: estimate.policyVersion,
    calculatedAt,
    expiresAt
  };
}

function scopeSummary(value: unknown): RankEstimate["scope"] {
  const scope = exactRecord(value, [
    "keywordCount",
    "contextCount",
    "pairCount",
    "scopeHash",
    "contextVersion",
    "configurationVersion"
  ]);
  const keywordCount = boundedCount(scope.keywordCount);
  const pairCount = boundedCount(scope.pairCount);
  const contextVersion = positiveInteger(scope.contextVersion);
  const configurationVersion = positiveInteger(
    scope.configurationVersion
  );
  if (
    scope.contextCount !== "1" ||
    pairCount !== keywordCount ||
    configurationVersion > contextVersion
  ) {
    throw invalidResponse();
  }
  return {
    keywordCount,
    contextCount: "1",
    pairCount,
    scopeHash: scopeHash(scope.scopeHash),
    contextVersion,
    configurationVersion
  };
}

function providerWorkload(
  value: unknown,
  keywordCount: string
): RankEstimate["workload"] {
  const workload = exactRecord(value, [
    "taskCount",
    "minimumRequestCount",
    "pollingRequestCount",
    "requestStages",
    "keywordLimitPerTask",
    "keywordLimitPerCommand",
    "format",
    "rawSerp",
    "fallbackMode"
  ]);
  const taskCount = boundedCount(workload.taskCount);
  const minimumRequestCount = boundedCount(
    workload.minimumRequestCount
  );
  const keywordCountValue = BigInt(keywordCount);
  const expectedTasks =
    keywordCountValue > 1_000n
      ? 0n
      : (keywordCountValue + 249n) / 250n;
  const requestStages = workload.requestStages;
  if (
    BigInt(taskCount) !== expectedTasks ||
    BigInt(minimumRequestCount) !== expectedTasks * 3n ||
    exactStatus(workload.pollingRequestCount) !== "NOT_AVAILABLE" ||
    !Array.isArray(requestStages) ||
    requestStages.length !== 3 ||
    requestStages[0] !== "SET" ||
    requestStages[1] !== "CHECK" ||
    requestStages[2] !== "GET" ||
    workload.keywordLimitPerTask !== "250" ||
    workload.keywordLimitPerCommand !== "1000" ||
    workload.format !== "SIMPLE" ||
    workload.rawSerp !== false ||
    workload.fallbackMode !== "NONE"
  ) {
    throw invalidResponse();
  }
  return {
    taskCount,
    minimumRequestCount,
    pollingRequestCount: { status: "NOT_AVAILABLE" },
    requestStages: ["SET", "CHECK", "GET"],
    keywordLimitPerTask: "250",
    keywordLimitPerCommand: "1000",
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE"
  };
}

function scopeHash(value: unknown): RankEstimateScopeHash {
  const hash = record(value);
  if (
    hash.availability === "UNAVAILABLE" &&
    Object.keys(hash).length === 1
  ) {
    return { availability: "UNAVAILABLE" };
  }
  if (
    hash.availability === "AVAILABLE" &&
    hash.algorithm === "SHA_256" &&
    typeof hash.value === "string" &&
    SHA_256_PATTERN.test(hash.value) &&
    Object.keys(hash).length === 3
  ) {
    return {
      availability: "AVAILABLE",
      algorithm: "SHA_256",
      value: hash.value
    };
  }
  throw invalidResponse();
}

function quota(value: unknown): RankEstimateQuota {
  const item = record(value);
  if (
    item.status === "NOT_AVAILABLE" &&
    Object.keys(item).length === 1
  ) {
    return { status: "NOT_AVAILABLE" };
  }
  if (item.status !== "AVAILABLE" && item.status !== "EXHAUSTED") {
    throw invalidResponse();
  }
  const exact = exactRecord(item, [
    "status",
    "limit",
    "used",
    "remaining",
    "resetsAt"
  ]);
  const limit = decimal(exact.limit);
  const used = decimal(exact.used);
  const remaining = decimal(exact.remaining);
  const resetsAt =
    exact.resetsAt === undefined ? undefined : isoDate(exact.resetsAt);
  if (
    BigInt(used) + BigInt(remaining) !== BigInt(limit) ||
    (item.status === "EXHAUSTED") !== (remaining === "0")
  ) {
    throw invalidResponse();
  }
  return {
    status: item.status,
    limit,
    used,
    remaining,
    ...(resetsAt ? { resetsAt } : {})
  };
}

function credentialFreshness(
  value: unknown
): RankEstimateCredentialFreshness {
  const item = record(value);
  if (
    (item.status === "UNVERIFIED" ||
      item.status === "NOT_AVAILABLE") &&
    Object.keys(item).length === 1
  ) {
    return { status: item.status };
  }
  if (item.status === "FRESH") {
    const exact = exactRecord(item, ["status", "verifiedAt"]);
    return {
      status: "FRESH",
      verifiedAt: isoDate(exact.verifiedAt)
    };
  }
  if (item.status === "STALE") {
    const exact = exactRecord(item, ["status", "verifiedAt"]);
    return {
      status: "STALE",
      ...(exact.verifiedAt === undefined
        ? {}
        : { verifiedAt: isoDate(exact.verifiedAt) })
    };
  }
  throw invalidResponse();
}

function retention(value: unknown): RankEstimate["retention"] {
  const item = exactRecord(value, [
    "normalizedRankHistory",
    "rawSerp"
  ]);
  if (
    item.normalizedRankHistory !== "LONG_TERM" ||
    item.rawSerp !== "NOT_COLLECTED"
  ) {
    throw invalidResponse();
  }
  return {
    normalizedRankHistory: "LONG_TERM",
    rawSerp: "NOT_COLLECTED"
  };
}

function blockerList(value: unknown): readonly RankEstimateBlocker[] {
  if (!Array.isArray(value) || value.length > rankEstimateBlockerCodes.length) {
    throw invalidResponse();
  }
  const result = value.map((candidate) => {
    const blocker = exactRecord(candidate, ["code"]);
    if (
      typeof blocker.code !== "string" ||
      !BLOCKER_CODES.has(blocker.code)
    ) {
      throw invalidResponse();
    }
    return {
      code: blocker.code as RankEstimateBlocker["code"]
    };
  });
  if (new Set(result.map(({ code }) => code)).size !== result.length) {
    throw invalidResponse();
  }
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    if (
      !previous ||
      !current ||
      rankEstimateBlockerCodes.indexOf(previous.code) >=
        rankEstimateBlockerCodes.indexOf(current.code)
    ) {
      throw invalidResponse();
    }
  }
  return result;
}

function exactStatus(value: unknown): string {
  const item = exactRecord(value, ["status"]);
  return typeof item.status === "string" ? item.status : "";
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw invalidResponse();
  }
  return value.toLowerCase();
}

function boundedCount(value: unknown): string {
  const result = decimal(value);
  if (BigInt(result) > MAX_SCOPE_COUNT) throw invalidResponse();
  return result;
}

function decimal(value: unknown): string {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw invalidResponse();
  }
  return value;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw invalidResponse();
  }
  return Number(value);
}

function isoDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    Number.isNaN(Date.parse(value))
  ) {
    throw invalidResponse();
  }
  return value;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw invalidResponse();
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  const item = record(value);
  if (Object.keys(item).some((key) => !keys.includes(key))) {
    throw invalidResponse();
  }
  return item;
}

function invalidResponse(): DomainError {
  return new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Jobs service returned an invalid rank estimate",
    retryable: true
  });
}
