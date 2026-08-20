import { domainToASCII } from "node:url";
import {
  arsenkinClusteringKeywordLimit,
  clusteringClusterAssignmentActions,
  clusteringClusterFolderActions,
  clusteringDepths,
  clusteringFolderModes,
  clusteringFrequencyTypes,
  clusteringMethods,
  clusteringSearchEngines,
  type ApplyClusteringProposalInput,
  type CreateClusteringRunInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const REGION_PATTERN = /^(?:0|[1-9]\d{0,9})$/u;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;

export function createClusteringRunInput(value: unknown): CreateClusteringRunInput {
  const input = record(value, [
    "items", "searchEngine", "regionCode", "method", "overlapCount", "depth",
    "excludeMainPages", "stopDomains", "frequencyTypes", "replaceExistingClusters"
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
  const stopDomains = input.stopDomains.map((candidate, index) => domain(candidate, `stopDomains.${index}`));
  if (new Set(stopDomains).size !== stopDomains.length) invalid("stopDomains");
  if (!Array.isArray(input.frequencyTypes) || input.frequencyTypes.length > clusteringFrequencyTypes.length) {
    invalid("frequencyTypes");
  }
  const frequencyTypes = input.frequencyTypes.map((candidate, index) =>
    member(candidate, clusteringFrequencyTypes, `frequencyTypes.${index}`)
  );
  if (new Set(frequencyTypes).size !== frequencyTypes.length) invalid("frequencyTypes");
  return {
    items,
    searchEngine: member(input.searchEngine, clusteringSearchEngines, "searchEngine"),
    regionCode: pattern(input.regionCode, "regionCode", REGION_PATTERN),
    method: member(input.method, clusteringMethods, "method"),
    overlapCount: integer(input.overlapCount, "overlapCount", 2, 10),
    depth: numericMember(input.depth, clusteringDepths, "depth"),
    excludeMainPages: boolean(input.excludeMainPages, "excludeMainPages"),
    stopDomains,
    frequencyTypes,
    replaceExistingClusters: boolean(input.replaceExistingClusters, "replaceExistingClusters")
  };
}

export function applyClusteringProposalInput(value: unknown): ApplyClusteringProposalInput {
  const input = record(value, [
    "proposalVersion", "excludedClusterIds", "clusterNameOverrides", "folderMode",
    "clusterAssignmentOverrides", "keywordGroupOverrides", "clusterFolderOverrides",
    "parentGroupId", "createUnclusteredGroup"
  ]);
  if (!Array.isArray(input.excludedClusterIds) || input.excludedClusterIds.length > arsenkinClusteringKeywordLimit) {
    invalid("excludedClusterIds");
  }
  const excludedClusterIds = input.excludedClusterIds.map((candidate, index) =>
    uuid(candidate, `excludedClusterIds.${index}`)
  );
  if (new Set(excludedClusterIds).size !== excludedClusterIds.length) invalid("excludedClusterIds");
  if (!Array.isArray(input.clusterNameOverrides) || input.clusterNameOverrides.length > arsenkinClusteringKeywordLimit) {
    invalid("clusterNameOverrides");
  }
  const clusterNameOverrides = input.clusterNameOverrides.map((candidate, index) => {
    const override = record(candidate, ["proposalClusterId", "name"]);
    return {
      proposalClusterId: uuid(override.proposalClusterId, `clusterNameOverrides.${index}.proposalClusterId`),
      name: bounded(override.name, `clusterNameOverrides.${index}.name`, 255)
    };
  });
  if (new Set(clusterNameOverrides.map(({ proposalClusterId }) => proposalClusterId)).size !== clusterNameOverrides.length) {
    invalid("clusterNameOverrides");
  }
  if (
    !Array.isArray(input.clusterAssignmentOverrides) ||
    input.clusterAssignmentOverrides.length > arsenkinClusteringKeywordLimit
  ) {
    invalid("clusterAssignmentOverrides");
  }
  const clusterAssignmentOverrides = input.clusterAssignmentOverrides.map((candidate, index) => {
    const override = record(candidate, ["proposalClusterId", "action", "clusterId"]);
    const action = member(
      override.action,
      clusteringClusterAssignmentActions,
      `clusterAssignmentOverrides.${index}.action`
    );
    const clusterId = override.clusterId === undefined
      ? undefined
      : uuid(override.clusterId, `clusterAssignmentOverrides.${index}.clusterId`);
    if ((action === "EXISTING") !== Boolean(clusterId)) {
      invalid(`clusterAssignmentOverrides.${index}`);
    }
    return {
      proposalClusterId: uuid(
        override.proposalClusterId,
        `clusterAssignmentOverrides.${index}.proposalClusterId`
      ),
      action,
      ...(clusterId ? { clusterId } : {})
    };
  });
  if (
    new Set(clusterAssignmentOverrides.map(({ proposalClusterId }) => proposalClusterId)).size !==
    clusterAssignmentOverrides.length
  ) {
    invalid("clusterAssignmentOverrides");
  }
  if (!Array.isArray(input.keywordGroupOverrides) || input.keywordGroupOverrides.length > arsenkinClusteringKeywordLimit) {
    invalid("keywordGroupOverrides");
  }
  const keywordGroupOverrides = input.keywordGroupOverrides.map((candidate, index) => {
    const override = record(candidate, ["keywordId", "groupId"]);
    return {
      keywordId: uuid(override.keywordId, `keywordGroupOverrides.${index}.keywordId`),
      groupId: uuid(override.groupId, `keywordGroupOverrides.${index}.groupId`)
    };
  });
  if (new Set(keywordGroupOverrides.map(({ keywordId }) => keywordId)).size !== keywordGroupOverrides.length) {
    invalid("keywordGroupOverrides");
  }
  if (!Array.isArray(input.clusterFolderOverrides) || input.clusterFolderOverrides.length > arsenkinClusteringKeywordLimit) {
    invalid("clusterFolderOverrides");
  }
  const clusterFolderOverrides = input.clusterFolderOverrides.map((candidate, index) => {
    const override = record(candidate, [
      "proposalClusterId", "action", "groupId", "parentGroupId"
    ]);
    const action = member(
      override.action,
      clusteringClusterFolderActions,
      `clusterFolderOverrides.${index}.action`
    );
    const groupId = override.groupId === undefined
      ? undefined
      : uuid(override.groupId, `clusterFolderOverrides.${index}.groupId`);
    const parentGroupId = override.parentGroupId === undefined
      ? undefined
      : uuid(override.parentGroupId, `clusterFolderOverrides.${index}.parentGroupId`);
    if (
      (action === "EXISTING" && (!groupId || parentGroupId)) ||
      (action === "NEW" && groupId) ||
      (action === "KEEP" && (groupId || parentGroupId))
    ) {
      invalid(`clusterFolderOverrides.${index}`);
    }
    return {
      proposalClusterId: uuid(override.proposalClusterId, `clusterFolderOverrides.${index}.proposalClusterId`),
      action,
      ...(groupId ? { groupId } : {}),
      ...(parentGroupId ? { parentGroupId } : {})
    };
  });
  if (new Set(clusterFolderOverrides.map(({ proposalClusterId }) => proposalClusterId)).size !== clusterFolderOverrides.length) {
    invalid("clusterFolderOverrides");
  }
  const folderMode = member(input.folderMode, clusteringFolderModes, "folderMode");
  const parentGroupId = input.parentGroupId === undefined
    ? undefined
    : uuid(input.parentGroupId, "parentGroupId");
  const createUnclusteredGroup = boolean(input.createUnclusteredGroup, "createUnclusteredGroup");
  if (folderMode === "NONE" && (parentGroupId || createUnclusteredGroup)) invalid("folderMode");
  if (
    folderMode === "NONE" &&
    clusterFolderOverrides.some(({ action }) => action === "NEW")
  ) invalid("folderMode");
  return {
    proposalVersion: integer(input.proposalVersion, "proposalVersion", 1),
    excludedClusterIds,
    clusterNameOverrides,
    clusterAssignmentOverrides,
    keywordGroupOverrides,
    clusterFolderOverrides,
    folderMode,
    ...(parentGroupId ? { parentGroupId } : {}),
    createUnclusteredGroup
  };
}

export function clusteringProposalRejectInput(value: unknown): { readonly proposalVersion: number } {
  const input = record(value, ["proposalVersion"]);
  return { proposalVersion: integer(input.proposalVersion, "proposalVersion", 1) };
}

export function clusteringCancelInput(value: unknown): Record<string, never> {
  record(value, []);
  return {};
}

export function clusteringIdempotencyKey(value: unknown): string {
  return pattern(value, "Idempotency-Key", IDEMPOTENCY_KEY_PATTERN);
}

function record(value: unknown, fields: readonly string[]): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("body");
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !fields.includes(key))) invalid("body");
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
  const result = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!result || result.length > maximum) invalid(field);
  return result;
}

function domain(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field);
  const result = domainToASCII(
    value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/^www\./u, "")
  );
  if (!DOMAIN_PATTERN.test(result)) invalid(field);
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

function member<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) invalid(field);
  return value as T;
}

function numericMember<T extends number>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "number" || !values.includes(value as T)) invalid(field);
  return value as T;
}

function invalid(field: string): never {
  throw validationError(field, "INVALID", "Invalid clustering request");
}
