import {
  connectorRoutingScopes,
  currentRankProviderPolicyVersion,
  legacyRankProviderPolicyVersion,
  xmlStockRankProviderPolicyVersion,
  rankEstimateBlockerCodes,
  type RankEstimate,
  type RankEstimateBlocker,
  type RankEstimateCredentialFreshness,
  type RankEstimateQuota,
  type RankEstimateScopeHash
} from "@seo-platform/contracts";
import type { Prisma } from "../generated/prisma/client.js";

const TOP_LEVEL_FIELDS = [
  "id",
  "workspaceId",
  "projectId",
  "trackingContextId",
  "status",
  "provider",
  "routingScope",
  "connectorAttempts",
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
] as const;
const BLOCKER_CODES = new Set<string>(rankEstimateBlockerCodes);

export function rankEstimateSnapshot(value: unknown): RankEstimate {
  const input = exactRecordWithOptional(
    value,
    TOP_LEVEL_FIELDS,
    ["routingScope", "connectorAttempts"]
  );
  const scope = exactRecord(input.scope, [
    "keywordCount",
    "contextCount",
    "pairCount",
    "scopeHash",
    "contextVersion",
    "configurationVersion"
  ]);
  const workload = exactRecord(input.workload, [
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
  const polling = exactRecord(workload.pollingRequestCount, ["status"]);
  const providerLimits = exactRecord(input.providerLimits, ["status"]);
  const expectedDuration = exactRecord(input.expectedDuration, ["status"]);
  const retention = exactRecord(input.retention, [
    "normalizedRankHistory",
    "rawSerp"
  ]);
  const blockers = blockerList(input.blockers);
  const calculatedAt = timestamp(input.calculatedAt);
  const expiresAt = timestamp(input.expiresAt);
  const provider = rankProvider(input.provider);
  const policy = estimatePolicy(input.policyVersion, provider);
  const keywordCount = boundedDecimal(
    scope.keywordCount,
    policy.overflowCount
  );
  const taskCount = boundedDecimal(
    workload.taskCount,
    policy.maximumTaskCount
  );
  const minimumRequestCount = boundedDecimal(
    workload.minimumRequestCount,
    policy.maximumRequestCount
  );
  const scopeHash = hash(scope.scopeHash);
  const ready =
    input.status === "READY" &&
    input.executionAllowed === true &&
    blockers.length === 0;
  const blocked =
    input.status === "BLOCKED" &&
    input.executionAllowed === false &&
    blockers.length > 0;
  if (
    (!ready && !blocked) ||
    input.operation !== "POSITIONS" ||
    input.credentialMode !== "BYOK_API_KEY" ||
    scope.contextCount !== "1" ||
    scope.pairCount !== keywordCount ||
    !positiveInteger(scope.contextVersion) ||
    !positiveInteger(scope.configurationVersion) ||
    Number(scope.configurationVersion) > Number(scope.contextVersion) ||
    (keywordCount === "0" &&
      scopeHash.availability === "UNAVAILABLE") ||
    (keywordCount === String(policy.overflowCount) &&
      scopeHash.availability === "AVAILABLE") ||
    Number(taskCount) !==
      (keywordCount === String(policy.overflowCount)
        ? 0
        : policy.taskCount(Number(keywordCount))) ||
    !policy.validMinimumRequestCount(
      Number(taskCount),
      Number(minimumRequestCount),
      workload.requestStages
    ) ||
    polling.status !== "NOT_AVAILABLE" ||
    !Array.isArray(workload.requestStages) ||
    !policy.validRequestStages(workload.requestStages) ||
    workload.keywordLimitPerTask !== policy.keywordLimitPerTask ||
    workload.keywordLimitPerCommand !== policy.keywordLimitPerCommand ||
    workload.format !== "SIMPLE" ||
    workload.rawSerp !== false ||
    workload.fallbackMode !== "NONE" ||
    providerLimits.status !== "NOT_AVAILABLE" ||
    expectedDuration.status !== "NOT_AVAILABLE" ||
    input.platformChargeMicro !== "0" ||
    typeof input.billingCurrency !== "string" ||
    !/^[A-Z]{3}$/u.test(input.billingCurrency) ||
    retention.normalizedRankHistory !== "LONG_TERM" ||
    retention.rawSerp !== "NOT_COLLECTED" ||
    expiresAt.getTime() - calculatedAt.getTime() !== 5 * 60 * 1_000
  ) {
    invalid();
  }
  return {
    id: uuid(input.id),
    workspaceId: uuid(input.workspaceId),
    projectId: uuid(input.projectId),
    trackingContextId: uuid(input.trackingContextId),
    status: ready ? "READY" : "BLOCKED",
    provider,
    ...(input.routingScope === undefined
      ? {}
      : {
          routingScope: member(input.routingScope, connectorRoutingScopes),
          connectorAttempts: connectorAttempts(input.connectorAttempts)
        }),
    operation: "POSITIONS",
    credentialMode: "BYOK_API_KEY",
    scope: {
      keywordCount,
      contextCount: "1",
      pairCount: scope.pairCount,
      scopeHash,
      contextVersion: Number(scope.contextVersion),
      configurationVersion: Number(scope.configurationVersion)
    },
    workload: {
      taskCount,
      minimumRequestCount,
      pollingRequestCount: { status: "NOT_AVAILABLE" },
      requestStages: workload.requestStages,
      keywordLimitPerTask: policy.keywordLimitPerTask,
      keywordLimitPerCommand: policy.keywordLimitPerCommand,
      format: "SIMPLE",
      rawSerp: false,
      fallbackMode: "NONE"
    },
    providerLimits: { status: "NOT_AVAILABLE" },
    expectedDuration: { status: "NOT_AVAILABLE" },
    platformChargeMicro: "0",
    billingCurrency: input.billingCurrency,
    quota: quota(input.quota),
    credentialFreshness: freshness(input.credentialFreshness),
    retention: {
      normalizedRankHistory: "LONG_TERM",
      rawSerp: "NOT_COLLECTED"
    },
    blockers,
    executionAllowed: ready,
    policyVersion: policy.version,
    calculatedAt: calculatedAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
}

function connectorAttempts(value: unknown): NonNullable<RankEstimate["connectorAttempts"]> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) invalid();
  return value.map((candidate, index) => {
    const input = exactRecordWithOptional(candidate, [
      "sequence",
      "provider",
      "routingScope",
      "outcome",
      "reasonCode",
      "occurredAt"
    ], ["reasonCode"]);
    if (input.sequence !== index + 1) invalid();
    const reasonCode = input.reasonCode;
    if (
      reasonCode !== undefined &&
      (typeof reasonCode !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(reasonCode))
    ) invalid();
    return {
      sequence: index + 1,
      provider: member(input.provider, ["XMLSTOCK", "ARSENKIN", "KEYS_SO"] as const),
      routingScope: member(input.routingScope, connectorRoutingScopes),
      outcome: member(input.outcome, ["SELECTED", "SUCCEEDED", "FALLBACK", "FAILED"] as const),
      ...(reasonCode === undefined ? {} : { reasonCode }),
      occurredAt: timestamp(input.occurredAt).toISOString()
    };
  });
}

export function rankEstimateSnapshotJson(
  value: RankEstimate
): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

interface EstimatePolicy {
  readonly version:
    | typeof legacyRankProviderPolicyVersion
    | typeof currentRankProviderPolicyVersion
    | typeof xmlStockRankProviderPolicyVersion;
  readonly overflowCount: 1_001 | 15_001;
  readonly maximumTaskCount: 1 | 4 | 15_000;
  readonly maximumRequestCount: number;
  readonly keywordLimitPerTask: "1" | "250" | "15000";
  readonly keywordLimitPerCommand: "1000" | "15000";
  readonly taskCount: (keywordCount: number) => number;
  readonly validRequestStages: (value: unknown) => value is RankEstimate["workload"]["requestStages"];
  readonly validMinimumRequestCount: (
    taskCount: number,
    minimumRequestCount: number,
    stages: unknown
  ) => boolean;
}

function estimatePolicy(
  value: unknown,
  provider: "ARSENKIN" | "XMLSTOCK"
): EstimatePolicy {
  if (provider === "ARSENKIN" && value === legacyRankProviderPolicyVersion) {
    return {
      version: legacyRankProviderPolicyVersion,
      overflowCount: 1_001,
      maximumTaskCount: 4,
      maximumRequestCount: 12,
      keywordLimitPerTask: "250",
      keywordLimitPerCommand: "1000",
      taskCount: (keywordCount) => Math.ceil(keywordCount / 250),
      validRequestStages: isArsenkinStages,
      validMinimumRequestCount: (tasks, requests) => requests === tasks * 3
    };
  }
  if (provider === "ARSENKIN" && value === currentRankProviderPolicyVersion) {
    return {
      version: currentRankProviderPolicyVersion,
      overflowCount: 15_001,
      maximumTaskCount: 1,
      maximumRequestCount: 3,
      keywordLimitPerTask: "15000",
      keywordLimitPerCommand: "15000",
      taskCount: (keywordCount) => (keywordCount === 0 ? 0 : 1),
      validRequestStages: isArsenkinStages,
      validMinimumRequestCount: (tasks, requests) => requests === tasks * 3
    };
  }
  if (
    provider === "XMLSTOCK" &&
    value === xmlStockRankProviderPolicyVersion
  ) {
    return {
      version: xmlStockRankProviderPolicyVersion,
      overflowCount: 15_001,
      maximumTaskCount: 15_000,
      maximumRequestCount: 150_000,
      keywordLimitPerTask: "1",
      keywordLimitPerCommand: "15000",
      taskCount: (keywordCount) => keywordCount,
      validRequestStages: isXmlStockStages,
      validMinimumRequestCount: (tasks, requests, stages) =>
        isYandexXmlStockStages(stages)
          ? requests === tasks * 2
          : isGoogleXmlStockStages(stages) &&
            requests >= tasks &&
            requests <= tasks * 10
    };
  }
  invalid();
}

function rankProvider(value: unknown): "ARSENKIN" | "XMLSTOCK" {
  if (value !== "ARSENKIN" && value !== "XMLSTOCK") invalid();
  return value;
}

function isArsenkinStages(
  value: unknown
): value is readonly ["SET", "CHECK", "GET"] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value[0] === "SET" &&
    value[1] === "CHECK" &&
    value[2] === "GET"
  );
}

function isYandexXmlStockStages(
  value: unknown
): value is readonly ["SUBMIT", "POLL"] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value[0] === "SUBMIT" &&
    value[1] === "POLL"
  );
}

function isGoogleXmlStockStages(
  value: unknown
): value is readonly ["GET"] {
  return Array.isArray(value) && value.length === 1 && value[0] === "GET";
}

function isXmlStockStages(
  value: unknown
): value is readonly ["SUBMIT", "POLL"] | readonly ["GET"] {
  return isYandexXmlStockStages(value) || isGoogleXmlStockStages(value);
}

function quota(value: unknown): RankEstimateQuota {
  const input = record(value);
  if (input.status === "UNLIMITED" || input.status === "NOT_AVAILABLE") {
    exactFields(input, ["status"]);
    return { status: input.status };
  }
  if (input.status !== "AVAILABLE" && input.status !== "EXHAUSTED") {
    invalid();
  }
  exactFields(input, [
    "status",
    "limit",
    "used",
    "remaining",
    ...(input.resetsAt === undefined ? [] : ["resetsAt"])
  ]);
  const limit = decimal(input.limit);
  const used = decimal(input.used);
  const remaining = decimal(input.remaining);
  if (
    BigInt(used) + BigInt(remaining) !== BigInt(limit) ||
    (input.status === "EXHAUSTED" && remaining !== "0") ||
    (input.status === "AVAILABLE" && remaining === "0")
  ) {
    invalid();
  }
  return {
    status: input.status,
    limit,
    used,
    remaining,
    ...(input.resetsAt === undefined
      ? {}
      : { resetsAt: timestamp(input.resetsAt).toISOString() })
  };
}

function freshness(value: unknown): RankEstimateCredentialFreshness {
  const input = record(value);
  if (
    input.status === "UNVERIFIED" ||
    input.status === "NOT_AVAILABLE"
  ) {
    exactFields(input, ["status"]);
    return { status: input.status };
  }
  if (input.status === "FRESH") {
    exactFields(input, ["status", "verifiedAt"]);
    return {
      status: "FRESH",
      verifiedAt: timestamp(input.verifiedAt).toISOString()
    };
  }
  if (input.status === "STALE") {
    exactFields(input, [
      "status",
      ...(input.verifiedAt === undefined ? [] : ["verifiedAt"])
    ]);
    return {
      status: "STALE",
      ...(input.verifiedAt === undefined
        ? {}
        : { verifiedAt: timestamp(input.verifiedAt).toISOString() })
    };
  }
  invalid();
}

function hash(value: unknown): RankEstimateScopeHash {
  const input = record(value);
  if (input.availability === "UNAVAILABLE") {
    exactFields(input, ["availability"]);
    return { availability: "UNAVAILABLE" };
  }
  exactFields(input, ["availability", "algorithm", "value"]);
  if (
    input.availability !== "AVAILABLE" ||
    input.algorithm !== "SHA_256" ||
    typeof input.value !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.value)
  ) {
    invalid();
  }
  return {
    availability: "AVAILABLE",
    algorithm: "SHA_256",
    value: input.value
  };
}

function blockerList(value: unknown): readonly RankEstimateBlocker[] {
  if (!Array.isArray(value) || value.length > 64) {
    invalid();
  }
  const blockers = value.map((candidate) => {
    const input = exactRecord(candidate, ["code"]);
    if (
      typeof input.code !== "string" ||
      !BLOCKER_CODES.has(input.code)
    ) {
      invalid();
    }
    return {
      code: input.code as RankEstimateBlocker["code"]
    };
  });
  if (new Set(blockers.map(({ code }) => code)).size !== blockers.length) {
    invalid();
  }
  let previousIndex = -1;
  for (const blocker of blockers) {
    const index = rankEstimateBlockerCodes.indexOf(blocker.code);
    if (index <= previousIndex) invalid();
    previousIndex = index;
  }
  return blockers;
}

function exactRecord<const Fields extends readonly string[]>(
  value: unknown,
  fields: Fields
): Readonly<Record<Fields[number], unknown>> {
  const input = record(value);
  exactFields(input, fields);
  return input as Readonly<Record<Fields[number], unknown>>;
}

function exactRecordWithOptional<const Fields extends readonly string[]>(
  value: unknown,
  fields: Fields,
  optional: readonly Fields[number][]
): Readonly<Record<Fields[number], unknown>> {
  const input = record(value);
  const optionalFields = new Set<string>(optional);
  const allowed = new Set<string>(fields);
  if (
    Object.keys(input).some((field) => !allowed.has(field)) ||
    fields.some((field) => !optionalFields.has(field) && !(field in input))
  ) invalid();
  return input as Readonly<Record<Fields[number], unknown>>;
}

function member<const Values extends readonly string[]>(
  value: unknown,
  values: Values
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid();
  return value as Values[number];
}

function exactFields(
  input: Readonly<Record<string, unknown>>,
  fields: readonly string[]
): void {
  const allowed = new Set(fields);
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !allowed.has(field)) ||
    fields.some((field) => !(field in input))
  ) {
    invalid();
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function uuid(value: unknown): string {
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

function timestamp(value: unknown): Date {
  if (typeof value !== "string") invalid();
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value
  ) {
    invalid();
  }
  return parsed;
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function boundedDecimal(value: unknown, maximum: number): string {
  const result = decimal(value);
  if (Number(result) > maximum) invalid();
  return result;
}

function decimal(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d{0,19})$/u.test(value)
  ) {
    invalid();
  }
  return value;
}

function invalid(): never {
  throw new Error("Invalid immutable rank estimate snapshot");
}
