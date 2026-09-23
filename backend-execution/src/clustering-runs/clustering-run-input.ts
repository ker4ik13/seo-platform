import { BadRequestException } from "@nestjs/common";
import { paidOperationAdmissionInput } from "../paid-operations/paid-operation-admission.js";
import {
  arsenkinClusteringKeywordLimit,
  clusteringDepths,
  clusteringFrequencyTypes,
  clusteringMethods,
  clusteringSearchEngines,
  type ClusteringDepth,
  type ClusteringFrequencyType,
  type ClusteringMethod,
  type ClusteringSearchEngine,
  type InternalCancelClusteringRunInput,
  type InternalCreateClusteringRunInput
} from "@seo-platform/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const REGION_PATTERN = /^(?:0|[1-9]\d{0,9})$/u;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;

export function internalCreateClusteringRunInput(
  value: unknown
): InternalCreateClusteringRunInput {
  const input = record(value, [
    "workspaceId",
    "billing",
    "projectId",
    "actorId",
    "idempotencyKey",
    "correlationId",
    "jobCapacity",
    "items",
    "credentialId",
    "searchEngine",
    "regionCode",
    "method",
    "overlapCount",
    "depth",
    "excludeMainPages",
    "stopDomains",
    "frequencyTypes",
    "replaceExistingClusters"
  ]);
  if (
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > arsenkinClusteringKeywordLimit
  ) invalid("items");
  const items = input.items.map((candidate, index) => {
    const item = record(candidate, ["id", "version"]);
    return {
      id: uuid(item.id, `items.${index}.id`),
      version: integer(item.version, `items.${index}.version`, 1)
    };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) invalid("items");
  if (!Array.isArray(input.stopDomains) || input.stopDomains.length > 100) invalid("stopDomains");
  const stopDomains = input.stopDomains.map((candidate, index) => {
    if (typeof candidate !== "string") invalid(`stopDomains.${index}`);
    const value = candidate.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/^www\./u, "");
    if (!DOMAIN_PATTERN.test(value)) invalid(`stopDomains.${index}`);
    return value;
  });
  if (new Set(stopDomains).size !== stopDomains.length) invalid("stopDomains");
  if (!Array.isArray(input.frequencyTypes) || input.frequencyTypes.length > clusteringFrequencyTypes.length) {
    invalid("frequencyTypes");
  }
  const frequencyTypes = input.frequencyTypes.map((candidate, index) =>
    member(candidate, clusteringFrequencyTypes, `frequencyTypes.${index}`)
  );
  if (new Set(frequencyTypes).size !== frequencyTypes.length) invalid("frequencyTypes");
  const capacity = record(input.jobCapacity, ["planCode", "planVersion", "concurrentJobs"]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    ...paidOperationAdmissionInput(input.billing),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    idempotencyKey: pattern(input.idempotencyKey, "idempotencyKey", KEY_PATTERN),
    correlationId: bounded(input.correlationId, "correlationId", 100),
    jobCapacity: {
      planCode: bounded(capacity.planCode, "jobCapacity.planCode", 64),
      planVersion: integer(capacity.planVersion, "jobCapacity.planVersion", 1),
      concurrentJobs: integer(capacity.concurrentJobs, "jobCapacity.concurrentJobs", 1)
    },
    items,
    ...(input.credentialId === undefined
      ? {}
      : { credentialId: uuid(input.credentialId, "credentialId") }),
    searchEngine: member(input.searchEngine, clusteringSearchEngines, "searchEngine"),
    regionCode: pattern(input.regionCode, "regionCode", REGION_PATTERN),
    method: member(input.method, clusteringMethods, "method"),
    overlapCount: integer(input.overlapCount, "overlapCount", 2, 10),
    depth: member(input.depth, clusteringDepths, "depth"),
    excludeMainPages: boolean(input.excludeMainPages, "excludeMainPages"),
    stopDomains,
    frequencyTypes,
    replaceExistingClusters: boolean(input.replaceExistingClusters, "replaceExistingClusters")
  };
}

export function internalCancelClusteringRunInput(
  value: unknown
): InternalCancelClusteringRunInput {
  const input = record(value, ["workspaceId", "projectId", "actorId"]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId")
  };
}

function record(value: unknown, allowed: readonly string[]): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("body");
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid("body");
  return input;
}

function uuid(value: unknown, field: string): string {
  return pattern(value, field, UUID_PATTERN).toLowerCase();
}

function pattern(value: unknown, field: string, expression: RegExp): string {
  if (typeof value !== "string" || !expression.test(value)) invalid(field);
  return value;
}

function bounded(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") invalid(field);
  const result = value.trim();
  if (!result || result.length > maximum) invalid(field);
  return result;
}

function integer(value: unknown, field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid(field);
  return Number(value);
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function member<T extends string | number>(value: unknown, values: readonly T[], field: string): T {
  if (!values.includes(value as T)) invalid(field);
  return value as T;
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid clustering run ${field}`);
}

void (null as unknown as ClusteringSearchEngine);
void (null as unknown as ClusteringMethod);
void (null as unknown as ClusteringDepth);
void (null as unknown as ClusteringFrequencyType);
