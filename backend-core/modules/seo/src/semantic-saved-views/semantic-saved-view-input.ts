import { BadRequestException } from "@nestjs/common";
import {
  semanticKeywordIntents,
  semanticKeywordSorts,
  semanticSavedViewDensities,
  semanticSavedViewScopes,
  semanticSystemColumnKeys,
  type InternalCreateSemanticSavedViewInput,
  type InternalDeleteSemanticSavedViewInput,
  type InternalUpdateSemanticSavedViewInput,
  type SemanticSavedViewConfig,
  type SemanticSavedViewFilters
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

export function internalCreateSemanticSavedViewInput(
  value: unknown
): InternalCreateSemanticSavedViewInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "name",
    "scope",
    "config"
  ]);
  return {
    ...scope(input),
    name: viewName(input.name),
    scope: requiredEnum(input.scope, semanticSavedViewScopes, "scope"),
    config: savedViewConfig(input.config)
  };
}

export function internalUpdateSemanticSavedViewInput(
  value: unknown
): InternalUpdateSemanticSavedViewInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "version",
    "name",
    "config"
  ]);
  if (input.name === undefined && input.config === undefined) invalid("$");
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version"),
    ...(input.name === undefined ? {} : { name: viewName(input.name) }),
    ...(input.config === undefined
      ? {}
      : { config: savedViewConfig(input.config) })
  };
}

export function internalDeleteSemanticSavedViewInput(
  value: unknown
): InternalDeleteSemanticSavedViewInput {
  const input = exactRecord(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "version"
  ]);
  return {
    ...scope(input),
    version: positiveInteger(input.version, "version")
  };
}

function savedViewConfig(value: unknown): SemanticSavedViewConfig {
  const input = exactRecord(value, [
    "schemaVersion",
    "filters",
    "sort",
    "columns",
    "density"
  ]);
  if (input.schemaVersion !== 1) invalid("config.schemaVersion");
  return {
    schemaVersion: 1,
    filters: savedViewFilters(input.filters),
    sort: requiredEnum(input.sort, semanticKeywordSorts, "config.sort"),
    columns: requiredColumns(input.columns),
    density: requiredEnum(
      input.density,
      semanticSavedViewDensities,
      "config.density"
    )
  };
}

function savedViewFilters(value: unknown): SemanticSavedViewFilters {
  const input = exactRecord(value, [
    "search",
    "tag",
    "intent",
    "groupId",
    "clusterId",
    "isFavorite",
    "isTracked",
    "priorityMin",
    "priorityMax"
  ]);
  const search = optionalString(input.search, "config.filters.search", 200);
  const tag = optionalString(input.tag, "config.filters.tag", 160)
    ?.toLocaleLowerCase();
  const intent =
    input.intent === undefined
      ? undefined
      : requiredEnum(
          input.intent,
          semanticKeywordIntents,
          "config.filters.intent"
        );
  const groupId =
    input.groupId === undefined
      ? undefined
      : uuid(input.groupId, "config.filters.groupId");
  const clusterId =
    input.clusterId === undefined
      ? undefined
      : uuid(input.clusterId, "config.filters.clusterId");
  const isFavorite = optionalBoolean(
    input.isFavorite,
    "config.filters.isFavorite"
  );
  const isTracked = optionalBoolean(
    input.isTracked,
    "config.filters.isTracked"
  );
  const priorityMin = optionalPriority(
    input.priorityMin,
    "config.filters.priorityMin"
  );
  const priorityMax = optionalPriority(
    input.priorityMax,
    "config.filters.priorityMax"
  );
  if (
    priorityMin !== undefined &&
    priorityMax !== undefined &&
    priorityMin > priorityMax
  ) {
    invalid("config.filters.priorityMin");
  }
  return {
    ...(search ? { search } : {}),
    ...(tag ? { tag } : {}),
    ...(intent ? { intent } : {}),
    ...(groupId ? { groupId } : {}),
    ...(clusterId ? { clusterId } : {}),
    ...(isFavorite === undefined ? {} : { isFavorite }),
    ...(isTracked === undefined ? {} : { isTracked }),
    ...(priorityMin === undefined ? {} : { priorityMin }),
    ...(priorityMax === undefined ? {} : { priorityMax })
  };
}

function requiredColumns(value: unknown): SemanticSavedViewConfig["columns"] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 108
  ) {
    invalid("config.columns");
  }
  const columns = value.map((column, index) => {
    if (
      typeof column !== "string" ||
      (!semanticSystemColumnKeys.includes(
        column as (typeof semanticSystemColumnKeys)[number]
      ) &&
        !/^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          column
        ))
    ) {
      invalid(`config.columns[${index}]`);
    }
    return column as SemanticSavedViewConfig["columns"][number];
  });
  if (new Set(columns).size !== columns.length || !columns.includes("query")) {
    invalid("config.columns");
  }
  return columns;
}

function scope(input: Readonly<Record<string, unknown>>) {
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId")
  };
}

function viewName(value: unknown): string {
  if (typeof value !== "string") invalid("name");
  const name = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name || name.length > 160) invalid("name");
  return name;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalid(field);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length > maxLength) invalid(field);
  return normalized || undefined;
}

function optionalBoolean(
  value: unknown,
  field: string
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") invalid(field);
  return value;
}

function optionalPriority(
  value: unknown,
  field: string
): number | undefined {
  if (
    value === undefined
  ) {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100) {
    invalid(field);
  }
  return Number(value);
}

function requiredEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  field: string
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    invalid(field);
  }
  return value as T;
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
  throw new BadRequestException(`Invalid semantic saved view field: ${field}`);
}
