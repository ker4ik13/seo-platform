import {
  arsenkinClusteringKeywordLimit,
  clusteringDepths,
  clusteringFrequencyTypes,
  clusteringMethods,
  clusteringRunStatuses,
  clusteringSearchEngines,
  connectorRoutingScopes,
  type ClusteringRunSummary,
  type ConnectorOperationAttemptSummary
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

export function scopedClusteringRun(
  value: unknown,
  workspaceId: string,
  projectId: string,
  expectedId?: string
): ClusteringRunSummary {
  const input = record(value);
  const id = uuid(input.id);
  if (
    input.workspaceId !== workspaceId ||
    input.projectId !== projectId ||
    (expectedId && id !== expectedId) ||
    input.provider !== "ARSENKIN"
  ) invalid();
  const hasScope = input.routingScope !== undefined;
  const hasAttempts = input.connectorAttempts !== undefined;
  if (hasScope !== hasAttempts) invalid();
  const stopDomains = strings(input.stopDomains, 100, 253);
  const frequencyTypes = members(input.frequencyTypes, clusteringFrequencyTypes);
  return {
    id,
    workspaceId,
    projectId,
    ...(input.actorId === undefined ? {} : { actorId: uuid(input.actorId) }),
    provider: "ARSENKIN",
    ...(hasScope ? { routingScope: member(input.routingScope, connectorRoutingScopes) } : {}),
    ...(hasAttempts ? { connectorAttempts: attempts(input.connectorAttempts) } : {}),
    status: member(input.status, clusteringRunStatuses),
    ...(typeof input.stage === "string" ? { stage: bounded(input.stage, 64) } : {}),
    selectedKeywords: integer(input.selectedKeywords, 1, arsenkinClusteringKeywordLimit),
    completedKeywords: integer(input.completedKeywords, 0, arsenkinClusteringKeywordLimit),
    failedKeywords: integer(input.failedKeywords, 0, arsenkinClusteringKeywordLimit),
    searchEngine: member(input.searchEngine, clusteringSearchEngines),
    regionCode: bounded(input.regionCode, 100),
    method: member(input.method, clusteringMethods),
    overlapCount: integer(input.overlapCount, 2, 10),
    depth: numericMember(input.depth, clusteringDepths),
    excludeMainPages: boolean(input.excludeMainPages),
    stopDomains,
    frequencyTypes,
    replaceExistingClusters: boolean(input.replaceExistingClusters),
    ...(input.proposalId === undefined ? {} : { proposalId: uuid(input.proposalId) }),
    ...(input.clusterCount === undefined
      ? {}
      : { clusterCount: integer(input.clusterCount, 0, arsenkinClusteringKeywordLimit) }),
    ...(input.unclusteredCount === undefined
      ? {}
      : { unclusteredCount: integer(input.unclusteredCount, 0, arsenkinClusteringKeywordLimit) }),
    ...(input.retryAt === undefined ? {} : { retryAt: timestamp(input.retryAt) }),
    ...(input.failureCode === undefined ? {} : { failureCode: bounded(input.failureCode, 64) }),
    version: integer(input.version, 1, Number.MAX_SAFE_INTEGER),
    createdAt: timestamp(input.createdAt),
    updatedAt: timestamp(input.updatedAt),
    ...(input.startedAt === undefined ? {} : { startedAt: timestamp(input.startedAt) }),
    ...(input.finishedAt === undefined ? {} : { finishedAt: timestamp(input.finishedAt) })
  };
}

function attempts(value: unknown): readonly ConnectorOperationAttemptSummary[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) invalid();
  return value.map((candidate, index) => {
    const input = record(candidate);
    if (input.sequence !== index + 1 || input.provider !== "ARSENKIN") invalid();
    return {
      sequence: index + 1,
      provider: "ARSENKIN",
      routingScope: member(input.routingScope, connectorRoutingScopes),
      outcome: member(input.outcome, ["SELECTED", "SUCCEEDED", "FALLBACK", "FAILED"] as const),
      ...(typeof input.reasonCode === "string" ? { reasonCode: bounded(input.reasonCode, 64) } : {}),
      occurredAt: timestamp(input.occurredAt)
    };
  });
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Readonly<Record<string, unknown>>;
}

function member<const Values extends readonly string[]>(value: unknown, values: Values): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid();
  return value as Values[number];
}

function numericMember<const Values extends readonly number[]>(value: unknown, values: Values): Values[number] {
  if (typeof value !== "number" || !values.includes(value)) invalid();
  return value as Values[number];
}

function members<const Values extends readonly string[]>(value: unknown, values: Values): readonly Values[number][] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !values.includes(entry))) invalid();
  return value as Values[number][];
}

function strings(value: unknown, maximumCount: number, maximumLength: number): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > maximumCount ||
    value.some((entry) => typeof entry !== "string" || entry.length < 1 || entry.length > maximumLength)
  ) invalid();
  return value as string[];
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) invalid();
  return value.toLowerCase();
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid();
  return Number(value);
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

function bounded(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value || value.length > maximum) invalid();
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") invalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid();
  return value;
}

function invalid(): never {
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "Jobs returned an invalid clustering run response",
    retryable: true
  });
}
