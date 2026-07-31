import { BadRequestException } from "@nestjs/common";
import type {
  InternalCreateSemanticClusterInput,
  InternalDeleteSemanticClusterInput,
  InternalSemanticClusterMergeInput,
  InternalSemanticClusterPageBulkInput,
  InternalUpdateSemanticClusterInput,
  SemanticClusterPageSource
} from "@seo-platform/contracts";
import { semanticClusterPageSources } from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

const PAGE_SOURCES = new Set<string>(semanticClusterPageSources);

export function internalCreateSemanticClusterInput(
  value: unknown
): InternalCreateSemanticClusterInput {
  const input = exactRecord(value, [...scopeFields(), ...editableFields()]);
  if (input.primaryPageId === undefined && hasMappingMetadata(input)) invalid("primaryPageId");
  return {
    ...scope(input),
    name: clusterName(input.name),
    ...createMappingInput(input)
  };
}

export function internalUpdateSemanticClusterInput(
  value: unknown
): InternalUpdateSemanticClusterInput {
  const input = exactRecord(value, [
    ...scopeFields(),
    "version",
    ...editableFields()
  ]);
  if (input.primaryPageId === null && hasMappingMetadata(input)) invalid("primaryPageId");
  return {
    ...scope(input),
    name: clusterName(input.name),
    ...updateMappingInput(input),
    version: positiveInteger(input.version, "version")
  };
}

export function internalDeleteSemanticClusterInput(
  value: unknown
): InternalDeleteSemanticClusterInput {
  const input = exactRecord(value, [...scopeFields(), "version"]);
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version")
  };
}

export function internalSemanticClusterPageBulkInput(
  value: unknown
): InternalSemanticClusterPageBulkInput {
  const input = exactRecord(value, [
    ...scopeFields(),
    "items",
    "primaryPageId",
    "pageMappingSource",
    "pageMappingConfidence",
    "pageMappingRationale"
  ]);
  if (!Object.hasOwn(input, "primaryPageId")) invalid("primaryPageId");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 200) {
    invalid("items");
  }
  const items = input.items.map((value) => {
    const item = exactRecord(value, ["id", "version"]);
    return {
      id: uuid(item.id, "items.id"),
      version: positiveInteger(item.version, "items.version")
    };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) invalid("items");
  const primaryPageId = bulkPageId(input.primaryPageId);
  if (primaryPageId === null && hasMappingMetadata(input)) invalid("primaryPageId");
  return {
    ...scope(input),
    items,
    primaryPageId,
    ...mappingMetadata(input)
  };
}

export function internalSemanticClusterMergeInput(
  value: unknown
): InternalSemanticClusterMergeInput {
  const input = exactRecord(value, [
    ...scopeFields(),
    "items",
    "targetClusterId"
  ]);
  const items = clusterSelections(input.items, 2, 50);
  const targetClusterId = uuid(input.targetClusterId, "targetClusterId");
  if (!items.some(({ id }) => id === targetClusterId)) invalid("targetClusterId");
  return {
    ...scope(input),
    items,
    targetClusterId
  };
}

function scopeFields(): readonly string[] {
  return ["workspaceId", "projectId", "actorId"];
}

function editableFields(): readonly string[] {
  return [
    "name",
    "isLocked",
    "excludeFromReclustering",
    "primaryPageId",
    "pageMappingSource",
    "pageMappingConfidence",
    "pageMappingRationale"
  ];
}

function createMappingInput(
  input: Readonly<Record<string, unknown>>
): Omit<InternalCreateSemanticClusterInput, "workspaceId" | "projectId" | "actorId" | "name"> {
  return {
    ...clusterControls(input),
    ...optionalCreatePageId(input.primaryPageId),
    ...mappingMetadata(input)
  };
}

function updateMappingInput(
  input: Readonly<Record<string, unknown>>
): Omit<InternalUpdateSemanticClusterInput, "workspaceId" | "projectId" | "actorId" | "name" | "version"> {
  return {
    ...clusterControls(input),
    ...optionalUpdatePageId(input.primaryPageId),
    ...mappingMetadata(input)
  };
}

function clusterControls(
  input: Readonly<Record<string, unknown>>
): Readonly<{ isLocked?: boolean; excludeFromReclustering?: boolean }> {
  return {
    ...(input.isLocked === undefined
      ? {}
      : { isLocked: boolean(input.isLocked, "isLocked") }),
    ...(input.excludeFromReclustering === undefined
      ? {}
      : {
          excludeFromReclustering: boolean(
            input.excludeFromReclustering,
            "excludeFromReclustering"
          )
        })
  };
}

function clusterSelections(
  value: unknown,
  minimum: number,
  maximum: number
): readonly { readonly id: string; readonly version: number }[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    invalid("items");
  }
  const items = value.map((entry) => {
    const item = exactRecord(entry, ["id", "version"]);
    return {
      id: uuid(item.id, "items.id"),
      version: positiveInteger(item.version, "items.version")
    };
  });
  if (new Set(items.map(({ id }) => id)).size !== items.length) invalid("items");
  return items;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function mappingMetadata(
  input: Readonly<Record<string, unknown>>
): Readonly<{
  pageMappingSource?: SemanticClusterPageSource;
  pageMappingConfidence?: number;
  pageMappingRationale?: string;
}> {
  return {
    ...(input.pageMappingSource === undefined
      ? {}
      : { pageMappingSource: pageSource(input.pageMappingSource) }),
    ...(input.pageMappingConfidence === undefined
      ? {}
      : { pageMappingConfidence: confidence(input.pageMappingConfidence) }),
    ...(input.pageMappingRationale === undefined
      ? {}
      : { pageMappingRationale: rationale(input.pageMappingRationale) })
  };
}

function optionalCreatePageId(
  value: unknown
): Readonly<{ primaryPageId?: string }> {
  if (value === undefined) return {};
  return { primaryPageId: uuid(value, "primaryPageId") };
}

function optionalUpdatePageId(
  value: unknown
): Readonly<{ primaryPageId?: string | null }> {
  if (value === null) return { primaryPageId: null };
  return optionalCreatePageId(value);
}

function bulkPageId(value: unknown): string | null {
  return value === null ? null : uuid(value, "primaryPageId");
}

function pageSource(value: unknown): SemanticClusterPageSource {
  if (typeof value !== "string" || !PAGE_SOURCES.has(value)) invalid("pageMappingSource");
  return value as SemanticClusterPageSource;
}

function confidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    invalid("pageMappingConfidence");
  }
  return value;
}

function rationale(value: unknown): string {
  if (typeof value !== "string") invalid("pageMappingRationale");
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > 2_000) invalid("pageMappingRationale");
  return normalized;
}

function hasMappingMetadata(input: Readonly<Record<string, unknown>>): boolean {
  return [
    input.pageMappingSource,
    input.pageMappingConfidence,
    input.pageMappingRationale
  ].some((item) => item !== undefined);
}

function scope(input: Readonly<Record<string, unknown>>) {
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId")
  };
}

function clusterName(value: unknown): string {
  if (typeof value !== "string") invalid("name");
  const name = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name || name.length > 255) invalid("name");
  return name;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field);
  return internalUuid(value, field);
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) invalid(field);
  return Number(value);
}

function exactRecord(
  value: unknown,
  allowed: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("$");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid("$");
  return input;
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid semantic cluster field: ${field}`);
}
