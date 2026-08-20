import { BadRequestException } from "@nestjs/common";
import {
  arsenkinClusteringKeywordLimit,
  clusteringClusterAssignmentActions,
  clusteringClusterFolderActions,
  clusteringFolderModes,
  clusteringMethods,
  clusteringSearchEngines,
  internalClusteringPersistItemLimit,
  internalClusteringResolveBatchLimit,
  type InternalApplyClusteringProposalInput,
  type InternalClusteringProposalResultInput,
  type InternalPersistClusteringProposalInput,
  type InternalRejectClusteringProposalInput,
  type InternalResolveClusteringKeywordsInput
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";
import { semanticCapacityEntitlement } from "../internal/semantic-capacity.js";

const INTEGER_PATTERN = /^(?:0|[1-9]\d{0,18})$/u;

export function internalResolveClusteringKeywordsInput(
  value: unknown
): InternalResolveClusteringKeywordsInput {
  const input = record(value, ["workspaceId", "projectId", "actorId", "items"]);
  if (
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > internalClusteringResolveBatchLimit
  ) invalid("items");
  const items = input.items.map((candidate, index) => {
    const item = record(candidate, ["id", "version"]);
    return {
      id: uuid(item.id, `items.${index}.id`),
      version: integer(item.version, `items.${index}.version`, 1)
    };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) invalid("items");
  return { ...scope(input), items };
}

export function internalPersistClusteringProposalInput(
  value: unknown
): InternalPersistClusteringProposalInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "provider",
    "connectorVersion",
    "parameters",
    "clusters",
    "items"
  ]);
  if (!Array.isArray(input.clusters) || input.clusters.length > arsenkinClusteringKeywordLimit) {
    invalid("clusters");
  }
  if (
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > internalClusteringPersistItemLimit
  ) invalid("items");
  const clusters = input.clusters.map((candidate, index) => {
    const cluster = record(candidate, [
      "sequence",
      "providerKey",
      "name",
      "topUrl",
      "topUrls",
      "frequencySum",
      "mainPageCount"
    ]);
    if (!Array.isArray(cluster.topUrls) || cluster.topUrls.length > 100) {
      invalid(`clusters.${index}.topUrls`);
    }
    const topUrls = cluster.topUrls.map((candidate, topUrlIndex) => {
      const topUrl = record(candidate, ["url", "overlapCount"]);
      return {
        url: url(topUrl.url, `clusters.${index}.topUrls.${topUrlIndex}.url`),
        ...(topUrl.overlapCount === undefined
          ? {}
          : {
              overlapCount: integer(
                topUrl.overlapCount,
                `clusters.${index}.topUrls.${topUrlIndex}.overlapCount`,
                0,
                arsenkinClusteringKeywordLimit
              )
            })
      };
    });
    if (new Set(topUrls.map(({ url: value }) => value)).size !== topUrls.length) {
      invalid(`clusters.${index}.topUrls`);
    }
    return {
      sequence: integer(cluster.sequence, `clusters.${index}.sequence`, 0),
      providerKey: bounded(cluster.providerKey, `clusters.${index}.providerKey`, 255),
      name: bounded(cluster.name, `clusters.${index}.name`, 255),
      ...(cluster.topUrl === undefined
        ? {}
        : { topUrl: url(cluster.topUrl, `clusters.${index}.topUrl`) }),
      topUrls,
      ...(cluster.frequencySum === undefined
        ? {}
        : { frequencySum: decimal(cluster.frequencySum, `clusters.${index}.frequencySum`) }),
      ...(cluster.mainPageCount === undefined
        ? {}
        : { mainPageCount: integer(cluster.mainPageCount, `clusters.${index}.mainPageCount`, 0) })
    };
  });
  if (
    new Set(clusters.map(({ sequence }) => sequence)).size !== clusters.length ||
    new Set(clusters.map(({ providerKey }) => providerKey)).size !== clusters.length ||
    clusters.some((cluster, index) => cluster.sequence !== index)
  ) invalid("clusters");
  const clusterSequences = new Set(clusters.map(({ sequence }) => sequence));
  const items = input.items.map((candidate, index) => {
    const item = record(candidate, [
      "sequence",
      "keywordId",
      "keywordVersion",
      "keywordText",
      "clusterSequence",
      "frequency",
      "exactFrequency",
      "aggregatorsPercent",
      "toponym",
      "geoDependent"
    ]);
    const clusterSequence = item.clusterSequence === undefined
      ? undefined
      : integer(item.clusterSequence, `items.${index}.clusterSequence`, 0);
    if (clusterSequence !== undefined && !clusterSequences.has(clusterSequence)) {
      invalid(`items.${index}.clusterSequence`);
    }
    return {
      sequence: integer(item.sequence, `items.${index}.sequence`, 0),
      keywordId: uuid(item.keywordId, `items.${index}.keywordId`),
      keywordVersion: integer(item.keywordVersion, `items.${index}.keywordVersion`, 1),
      keywordText: bounded(item.keywordText, `items.${index}.keywordText`, 400),
      ...(clusterSequence === undefined ? {} : { clusterSequence }),
      ...(item.frequency === undefined
        ? {}
        : { frequency: decimal(item.frequency, `items.${index}.frequency`) }),
      ...(item.exactFrequency === undefined
        ? {}
        : { exactFrequency: decimal(item.exactFrequency, `items.${index}.exactFrequency`) }),
      ...(item.aggregatorsPercent === undefined
        ? {}
        : { aggregatorsPercent: finite(item.aggregatorsPercent, `items.${index}.aggregatorsPercent`, 0, 100) }),
      ...(item.toponym === undefined
        ? {}
        : { toponym: bounded(item.toponym, `items.${index}.toponym`, 255) }),
      ...(item.geoDependent === undefined
        ? {}
        : { geoDependent: boolean(item.geoDependent, `items.${index}.geoDependent`) })
    };
  });
  if (
    new Set(items.map(({ sequence }) => sequence)).size !== items.length ||
    new Set(items.map(({ keywordId }) => keywordId)).size !== items.length ||
    items.some((item, index) => item.sequence !== index)
  ) invalid("items");
  const referencedClusterSequences = new Set(
    items.flatMap(({ clusterSequence }) => clusterSequence === undefined ? [] : [clusterSequence])
  );
  if (clusters.some(({ sequence }) => !referencedClusterSequences.has(sequence))) {
    invalid("clusters");
  }
  return {
    ...scope(input),
    jobId: uuid(input.jobId, "jobId"),
    provider: input.provider === "ARSENKIN" ? "ARSENKIN" : invalid("provider"),
    connectorVersion: bounded(input.connectorVersion, "connectorVersion", 100),
    parameters: clusteringParameters(input.parameters),
    clusters,
    items
  };
}

export function internalClusteringProposalResultInput(
  value: unknown
): InternalClusteringProposalResultInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "limit",
    "cursor"
  ]);
  return {
    ...scope(input),
    jobId: uuid(input.jobId, "jobId"),
    limit: integer(input.limit, "limit", 1, 500),
    ...(input.cursor === undefined
      ? {}
      : { cursor: integer(input.cursor, "cursor", 0, arsenkinClusteringKeywordLimit - 1) })
  };
}

export function internalApplyClusteringProposalInput(
  value: unknown
): InternalApplyClusteringProposalInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "proposalVersion",
    "excludedClusterIds",
    "clusterNameOverrides",
    "clusterAssignmentOverrides",
    "keywordGroupOverrides",
    "clusterFolderOverrides",
    "folderMode",
    "parentGroupId",
    "createUnclusteredGroup",
    "entitlement"
  ]);
  if (!Array.isArray(input.excludedClusterIds) || input.excludedClusterIds.length > arsenkinClusteringKeywordLimit) {
    invalid("excludedClusterIds");
  }
  const excludedClusterIds = input.excludedClusterIds.map((id, index) =>
    uuid(id, `excludedClusterIds.${index}`)
  );
  if (new Set(excludedClusterIds).size !== excludedClusterIds.length) {
    invalid("excludedClusterIds");
  }
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
  if (folderMode === "NONE" && (parentGroupId || createUnclusteredGroup)) {
    invalid("folderMode");
  }
  if (
    folderMode === "NONE" &&
    clusterFolderOverrides.some(({ action }) => action === "NEW")
  ) {
    invalid("folderMode");
  }
  return {
    ...scope(input),
    jobId: uuid(input.jobId, "jobId"),
    proposalVersion: integer(input.proposalVersion, "proposalVersion", 1),
    excludedClusterIds,
    clusterNameOverrides,
    clusterAssignmentOverrides,
    keywordGroupOverrides,
    clusterFolderOverrides,
    folderMode,
    ...(parentGroupId ? { parentGroupId } : {}),
    createUnclusteredGroup,
    entitlement: semanticCapacityEntitlement(input.entitlement)
  };
}

export function internalRejectClusteringProposalInput(
  value: unknown
): InternalRejectClusteringProposalInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "jobId",
    "proposalVersion"
  ]);
  return {
    ...scope(input),
    jobId: uuid(input.jobId, "jobId"),
    proposalVersion: integer(input.proposalVersion, "proposalVersion", 1)
  };
}

function clusteringParameters(value: unknown): InternalPersistClusteringProposalInput["parameters"] {
  const input = record(value, [
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
  if (!Array.isArray(input.stopDomains) || input.stopDomains.length > 100) invalid("parameters.stopDomains");
  const stopDomains = input.stopDomains.map((candidate, index) =>
    bounded(candidate, `parameters.stopDomains.${index}`, 253)
  );
  if (!Array.isArray(input.frequencyTypes) || input.frequencyTypes.length > 4) invalid("parameters.frequencyTypes");
  const frequencyTypes = input.frequencyTypes.map((candidate, index) => {
    if (!["BASE", "QUOTED", "OVERALL", "EXACT"].includes(String(candidate))) {
      invalid(`parameters.frequencyTypes.${index}`);
    }
    return candidate as "BASE" | "QUOTED" | "OVERALL" | "EXACT";
  });
  if (new Set(frequencyTypes).size !== frequencyTypes.length) invalid("parameters.frequencyTypes");
  const depth = integer(input.depth, "parameters.depth", 10, 30);
  if (![10, 20, 30].includes(depth)) invalid("parameters.depth");
  return {
    searchEngine: member(input.searchEngine, clusteringSearchEngines, "parameters.searchEngine"),
    regionCode: pattern(input.regionCode, "parameters.regionCode", /^(?:0|[1-9]\d{0,9})$/u),
    method: member(input.method, clusteringMethods, "parameters.method"),
    overlapCount: integer(input.overlapCount, "parameters.overlapCount", 2, 10),
    depth: depth as 10 | 20 | 30,
    excludeMainPages: boolean(input.excludeMainPages, "parameters.excludeMainPages"),
    stopDomains,
    frequencyTypes,
    replaceExistingClusters: boolean(input.replaceExistingClusters, "parameters.replaceExistingClusters")
  };
}

function scope(input: Readonly<Record<string, unknown>>) {
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
  if (typeof value !== "string") invalid(field);
  return internalUuid(value, field);
}

function integer(value: unknown, field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid(field);
  return Number(value);
}

function finite(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) invalid(field);
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function bounded(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") invalid(field);
  const result = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!result || result.length > maximum) invalid(field);
  return result;
}

function pattern(value: unknown, field: string, expression: RegExp): string {
  if (typeof value !== "string" || !expression.test(value)) invalid(field);
  return value;
}

function decimal(value: unknown, field: string): string {
  if (typeof value !== "string" || !INTEGER_PATTERN.test(value)) invalid(field);
  return value;
}

function url(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 8_192) invalid(field);
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) invalid(field);
    return parsed.toString();
  } catch {
    invalid(field);
  }
}

function member<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) invalid(field);
  return value as T;
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid clustering proposal ${field}`);
}
