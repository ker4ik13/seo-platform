import type {
  ClusteringDepth,
  ClusteringFrequencyType,
  ClusteringMethod,
  ClusteringRunStatus,
  ClusteringRunSummary,
  ClusteringSearchEngine,
  ConnectorOperationAttemptSummary,
  ConnectorRoutingScope
} from "@seo-platform/contracts";
import {
  arsenkinClusteringKeywordLimit,
  clusteringDepths,
  clusteringFrequencyTypes,
  clusteringMethods,
  clusteringSearchEngines
} from "@seo-platform/contracts";
import type { Job } from "../generated/prisma/client.js";

export function clusteringRunSummary(job: Job): ClusteringRunSummary {
  const input = object(job.inputSnapshot);
  const scope = object(job.scopeSnapshot);
  if (!job.projectId || job.progressTotal === null) invalid();
  const result = objectOrUndefined(job.resultSummary);
  const routingScope = connectorRoutingScope(scope.routingScope);
  const attempts = connectorAttempts(scope.connectorAttempts);
  const searchEngine = member(input.searchEngine, clusteringSearchEngines);
  const method = member(input.method, clusteringMethods);
  const depth = member(input.depth, clusteringDepths);
  const stopDomains = strings(input.stopDomains, 100);
  const frequencyTypes = members(input.frequencyTypes, clusteringFrequencyTypes);
  const selectedKeywords = count(job.progressTotal);
  const completedKeywords = count(job.progressCurrent);
  const failedKeywords = summaryCount(result, job.errorSummary);
  const proposalId = uuidOrUndefined(result?.proposalId);
  const clusterCount = nonNegativeOrUndefined(result?.clusterCount);
  const unclusteredCount = nonNegativeOrUndefined(result?.unclusteredCount);
  const resultCompleted = nonNegativeOrUndefined(result?.completed);
  if (
    job.type !== "CLUSTERING_RUN" ||
    job.provider !== "ARSENKIN" ||
    !searchEngine ||
    !method ||
    !depth ||
    typeof input.regionCode !== "string" ||
    !/^(?:0|[1-9]\d{0,9})$/u.test(input.regionCode) ||
    !Number.isSafeInteger(input.overlapCount) ||
    Number(input.overlapCount) < 2 ||
    Number(input.overlapCount) > 10 ||
    typeof input.excludeMainPages !== "boolean" ||
    typeof input.replaceExistingClusters !== "boolean" ||
    (routingScope === undefined) !== (attempts.length === 0) ||
    selectedKeywords < 1 ||
    completedKeywords + failedKeywords > selectedKeywords ||
    (result?.completed !== undefined && resultCompleted === undefined) ||
    (resultCompleted !== undefined && resultCompleted !== completedKeywords) ||
    (result?.proposalId !== undefined && !proposalId) ||
    (result?.clusterCount !== undefined && clusterCount === undefined) ||
    (result?.unclusteredCount !== undefined && unclusteredCount === undefined) ||
    (clusterCount !== undefined && clusterCount > selectedKeywords) ||
    (unclusteredCount !== undefined && unclusteredCount > selectedKeywords) ||
    ((clusterCount !== undefined || unclusteredCount !== undefined) && !proposalId)
  ) invalid();
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    projectId: job.projectId,
    provider: "ARSENKIN",
    ...(routingScope ? { routingScope } : {}),
    ...(attempts.length ? { connectorAttempts: attempts } : {}),
    status: status(job.status),
    ...(job.stage ? { stage: job.stage } : {}),
    selectedKeywords,
    completedKeywords,
    failedKeywords,
    searchEngine,
    regionCode: input.regionCode,
    method,
    overlapCount: Number(input.overlapCount),
    depth,
    excludeMainPages: input.excludeMainPages,
    stopDomains,
    frequencyTypes,
    replaceExistingClusters: input.replaceExistingClusters,
    ...(proposalId ? { proposalId } : {}),
    ...(clusterCount === undefined
      ? {}
      : { clusterCount }),
    ...(unclusteredCount === undefined
      ? {}
      : { unclusteredCount }),
    ...(job.retryAt ? { retryAt: job.retryAt.toISOString() } : {}),
    ...(failureCode(job.errorSummary) ? { failureCode: failureCode(job.errorSummary)! } : {}),
    version: job.version,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    ...(job.startedAt ? { startedAt: job.startedAt.toISOString() } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt.toISOString() } : {})
  };
}

function connectorAttempts(value: unknown): readonly ConnectorOperationAttemptSummary[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) invalid();
  return value.map((candidate, index) => {
    const input = object(candidate);
    const routingScope = connectorRoutingScope(input.routingScope);
    if (
      input.sequence !== index + 1 ||
      input.provider !== "ARSENKIN" ||
      !routingScope ||
      !["SELECTED", "SUCCEEDED", "FALLBACK", "FAILED"].includes(String(input.outcome)) ||
      typeof input.occurredAt !== "string" ||
      !Number.isFinite(new Date(input.occurredAt).getTime())
    ) invalid();
    return {
      sequence: index + 1,
      provider: "ARSENKIN",
      routingScope,
      outcome: input.outcome as ConnectorOperationAttemptSummary["outcome"],
      ...(typeof input.reasonCode === "string" ? { reasonCode: input.reasonCode } : {}),
      occurredAt: input.occurredAt
    };
  });
}

function connectorRoutingScope(value: unknown): ConnectorRoutingScope | undefined {
  return value === "WORKSPACE_DEFAULT" || value === "PROJECT_OVERRIDE" || value === "WORKSPACE_FALLBACK"
    ? value
    : undefined;
}

function member<T extends string | number>(value: unknown, values: readonly T[]): T | undefined {
  return values.includes(value as T) ? value as T : undefined;
}

function members<T extends string>(value: unknown, values: readonly T[]): readonly T[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => !values.includes(entry as T)) ||
    new Set(value).size !== value.length
  ) invalid();
  return value as T[];
}

function strings(value: unknown, maximum: number): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((entry) => typeof entry !== "string" || entry.length < 1 || entry.length > 253) ||
    new Set(value).size !== value.length
  ) invalid();
  return value as string[];
}

function status(value: string): ClusteringRunStatus {
  if ([
    "QUEUED", "RUNNING", "WAITING_RATE_LIMIT", "RETRY_SCHEDULED",
    "ACTION_REQUIRED", "CANCEL_REQUESTED", "CANCELLED", "PARTIALLY_COMPLETED",
    "COMPLETED", "FAILED_RETRYABLE", "FAILED_FINAL"
  ].includes(value)) return value as ClusteringRunStatus;
  invalid();
}

function count(value: bigint): number {
  const result = Number(value);
  if (
    !Number.isSafeInteger(result) ||
    result < 0 ||
    result > arsenkinClusteringKeywordLimit
  ) invalid();
  return result;
}

function summaryCount(
  result: Readonly<Record<string, unknown>> | undefined,
  error: unknown
): number {
  const resultFailed = result?.failed;
  const errorFailed = objectOrUndefined(error)?.failed;
  const failed = resultFailed ?? errorFailed ?? 0;
  if (
    !Number.isSafeInteger(failed) ||
    Number(failed) < 0 ||
    Number(failed) > arsenkinClusteringKeywordLimit ||
    (resultFailed !== undefined && errorFailed !== undefined && resultFailed !== errorFailed)
  ) invalid();
  return Number(failed);
}

function nonNegativeOrUndefined(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function uuidOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value.toLowerCase()
    : undefined;
}

function failureCode(value: unknown): string | undefined {
  const code = objectOrUndefined(value)?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/u.test(code) ? code : undefined;
}

function object(value: unknown): Readonly<Record<string, unknown>> {
  const result = objectOrUndefined(value);
  if (!result) invalid();
  return result;
}

function objectOrUndefined(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function invalid(): never {
  throw new Error("Invalid clustering run record");
}

void (null as unknown as ClusteringSearchEngine);
void (null as unknown as ClusteringMethod);
void (null as unknown as ClusteringDepth);
void (null as unknown as ClusteringFrequencyType);
