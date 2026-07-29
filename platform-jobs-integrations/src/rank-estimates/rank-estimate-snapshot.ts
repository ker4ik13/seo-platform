import {
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
  const input = exactRecord(value, TOP_LEVEL_FIELDS);
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
  const keywordCount = boundedDecimal(scope.keywordCount, 1_001);
  const taskCount = boundedDecimal(workload.taskCount, 4);
  const minimumRequestCount = boundedDecimal(
    workload.minimumRequestCount,
    12
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
    input.provider !== "ARSENKIN" ||
    input.operation !== "POSITIONS" ||
    input.credentialMode !== "BYOK_API_KEY" ||
    scope.contextCount !== "1" ||
    scope.pairCount !== keywordCount ||
    !positiveInteger(scope.contextVersion) ||
    !positiveInteger(scope.configurationVersion) ||
    Number(scope.configurationVersion) > Number(scope.contextVersion) ||
    (keywordCount === "0" &&
      scopeHash.availability === "UNAVAILABLE") ||
    (keywordCount === "1001" &&
      scopeHash.availability === "AVAILABLE") ||
    Number(taskCount) !==
      (keywordCount === "1001"
        ? 0
        : Math.ceil(Number(keywordCount) / 250)) ||
    Number(minimumRequestCount) !== Number(taskCount) * 3 ||
    polling.status !== "NOT_AVAILABLE" ||
    !Array.isArray(workload.requestStages) ||
    workload.requestStages.length !== 3 ||
    workload.requestStages[0] !== "SET" ||
    workload.requestStages[1] !== "CHECK" ||
    workload.requestStages[2] !== "GET" ||
    workload.keywordLimitPerTask !== "250" ||
    workload.keywordLimitPerCommand !== "1000" ||
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
    typeof input.policyVersion !== "string" ||
    input.policyVersion.length < 1 ||
    input.policyVersion.length > 64 ||
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
    provider: "ARSENKIN",
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
      requestStages: ["SET", "CHECK", "GET"],
      keywordLimitPerTask: "250",
      keywordLimitPerCommand: "1000",
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
    policyVersion: input.policyVersion,
    calculatedAt: calculatedAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
}

export function rankEstimateSnapshotJson(
  value: RankEstimate
): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function quota(value: unknown): RankEstimateQuota {
  const input = record(value);
  if (input.status === "NOT_AVAILABLE") {
    exactFields(input, ["status"]);
    return { status: "NOT_AVAILABLE" };
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
