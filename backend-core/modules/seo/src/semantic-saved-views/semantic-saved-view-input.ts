import { isSemanticRankDimensionSort, parseSemanticRankColumnKey, parseSemanticRankDimensionKey } from "@seo-platform/contracts";
import { BadRequestException } from "@nestjs/common";
import {
  semanticKeywordIntents,
  semanticKeywordPageSizes,
  semanticKeywordSorts,
  semanticSavedViewDensities,
  semanticSavedViewGroupSidebarWidthMax,
  semanticSavedViewGroupSidebarWidthMin,
  semanticSavedViewQueryIndicators,
  semanticSavedViewSchemaVersions,
  semanticSavedViewScopes,
  semanticSavedViewColumnOrderLimit,
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
    "canManageShared",
    "name",
    "scope",
    "config"
  ]);
  return {
    ...scope(input),
    canManageShared: boolean(input.canManageShared, "canManageShared"),
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
    "canManageShared",
    "version",
    "name",
    "config"
  ]);
  if (input.name === undefined && input.config === undefined) invalid("$");
  return {
    ...scope(input),
    canManageShared: boolean(input.canManageShared, "canManageShared"),
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
    "canManageShared",
    "version"
  ]);
  return {
    ...scope(input),
    canManageShared: boolean(input.canManageShared, "canManageShared"),
    version: positiveInteger(input.version, "version")
  };
}

function savedViewConfig(value: unknown): SemanticSavedViewConfig {
  const input = exactRecord(value, [
    "schemaVersion",
    "filters",
    "sort",
    "rankSortDimensionKey",
    "columns",
    "columnOrder",
    "density",
    "queryIndicators",
    "columnWidths",
    "pageSize",
    "groupSidebarWidth",
    "expandedGroupIds",
    "selectedGroupIds",
    "appliedViewId"
  ]);
  if (!semanticSavedViewSchemaVersions.some(
    (version) => version === input.schemaVersion
  )) invalid("config.schemaVersion");
  const columns = requiredColumns(input.columns);
  const columnOrder = optionalColumnOrder(input.columnOrder, columns);
  const queryIndicators = optionalQueryIndicators(input.queryIndicators);
  const columnWidths = optionalColumnWidths(input.columnWidths, columns);
  const pageSize = input.pageSize === undefined
    ? undefined
    : requiredNumberMember(input.pageSize, semanticKeywordPageSizes, "config.pageSize");
  const groupSidebarWidth = optionalInteger(
    input.groupSidebarWidth,
    "config.groupSidebarWidth",
    semanticSavedViewGroupSidebarWidthMin,
    semanticSavedViewGroupSidebarWidthMax
  );
  const expandedGroupIds = optionalUuidArray(input.expandedGroupIds, 1_000);
  const selectedGroupIds = optionalUuidArray(input.selectedGroupIds, 2_000);
  const sort = requiredEnum(input.sort, semanticKeywordSorts, "config.sort");
  const rankSortDimensionKey = input.rankSortDimensionKey;
  if (
    rankSortDimensionKey !== undefined &&
    !parseSemanticRankDimensionKey(rankSortDimensionKey)
  ) {
    invalid("config.rankSortDimensionKey");
  }
  if (
    isSemanticRankDimensionSort(sort) !== Boolean(rankSortDimensionKey) ||
    (rankSortDimensionKey !== undefined && input.schemaVersion !== 4)
  ) {
    invalid("config.rankSortDimensionKey");
  }
  const appliedViewId = input.appliedViewId === undefined
    ? undefined
    : uuid(input.appliedViewId, "config.appliedViewId");
  return {
    schemaVersion: input.schemaVersion as SemanticSavedViewConfig["schemaVersion"],
    filters: savedViewFilters(input.filters),
    sort,
    ...(typeof rankSortDimensionKey === "string"
      ? { rankSortDimensionKey }
      : {}),
    columns,
    ...(columnOrder === undefined ? {} : { columnOrder }),
    density: requiredEnum(
      input.density,
      semanticSavedViewDensities,
      "config.density"
    ),
    ...(queryIndicators === undefined ? {} : { queryIndicators }),
    ...(columnWidths ? { columnWidths } : {}),
    ...(pageSize === undefined ? {} : { pageSize }),
    ...(groupSidebarWidth === undefined ? {} : { groupSidebarWidth }),
    ...(expandedGroupIds ? { expandedGroupIds } : {}),
    ...(selectedGroupIds ? { selectedGroupIds } : {}),
    ...(appliedViewId ? { appliedViewId } : {})
  };
}

function optionalQueryIndicators(
  value: unknown
): SemanticSavedViewConfig["queryIndicators"] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > semanticSavedViewQueryIndicators.length) {
    invalid("config.queryIndicators");
  }
  const indicators = value.map((indicator, index) =>
    requiredEnum(
      indicator,
      semanticSavedViewQueryIndicators,
      `config.queryIndicators[${index}]`
    )
  );
  if (new Set(indicators).size !== indicators.length) {
    invalid("config.queryIndicators");
  }
  return indicators;
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
    "priorityMax",
    "frequencyBaseMin", "frequencyBaseMax", "frequencyExactMin", "frequencyExactMax",
    "frequencyFixedMin", "frequencyFixedMax", "wordCountMin", "wordCountMax", "targetUrlState", "multipleUrlsState",
    "rankDimensionKey", "rankState", "rankPositionMin", "rankPositionMax", "rankCheckedFrom", "rankCheckedBefore"
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
  const advanced = advancedFilters(input, "config.filters");
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
    ...(priorityMax === undefined ? {} : { priorityMax }),
    ...advanced
  };
}

function advancedFilters(input: Readonly<Record<string, unknown>>, field: string): Omit<SemanticSavedViewFilters, "search" | "tag" | "intent" | "groupId" | "clusterId" | "isFavorite" | "isTracked" | "priorityMin" | "priorityMax"> {
  const decimal = (name: string): string | undefined => {
    const value = input[name];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,18})$/u.test(value) || BigInt(value) > 9_223_372_036_854_775_807n) invalid(`${field}.${name}`);
    return value;
  };
  const integer = (name: string, max: number): number | undefined => {
    const value = input[name];
    if (value === undefined) return undefined;
    if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) invalid(`${field}.${name}`);
    return Number(value);
  };
  const baseMin = decimal("frequencyBaseMin"), baseMax = decimal("frequencyBaseMax");
  const exactMin = decimal("frequencyExactMin"), exactMax = decimal("frequencyExactMax");
  const fixedMin = decimal("frequencyFixedMin"), fixedMax = decimal("frequencyFixedMax");
  for (const [min, max, name] of [[baseMin, baseMax, "frequencyBaseMin"], [exactMin, exactMax, "frequencyExactMin"], [fixedMin, fixedMax, "frequencyFixedMin"]] as const) if (min && max && BigInt(min) > BigInt(max)) invalid(`${field}.${name}`);
  const wordCountMin = integer("wordCountMin", 10_000), wordCountMax = integer("wordCountMax", 10_000);
  const rankPositionMin = integer("rankPositionMin", 100), rankPositionMax = integer("rankPositionMax", 100);
  if (wordCountMin && wordCountMax && wordCountMin > wordCountMax) invalid(`${field}.wordCountMin`);
  if (rankPositionMin && rankPositionMax && rankPositionMin > rankPositionMax) invalid(`${field}.rankPositionMin`);
  const targetUrlState = input.targetUrlState === undefined ? undefined : requiredEnum(input.targetUrlState, ["SET", "EMPTY"] as const, `${field}.targetUrlState`);
  const multipleUrlsState = input.multipleUrlsState === undefined ? undefined : requiredEnum(input.multipleUrlsState, ["MULTIPLE", "NOT_MULTIPLE"] as const, `${field}.multipleUrlsState`);
  const rankState = input.rankState === undefined ? undefined : requiredEnum(input.rankState, ["CHECKED", "FOUND", "NOT_FOUND", "NOT_CHECKED"] as const, `${field}.rankState`);
  const rankDimensionKey = input.rankDimensionKey;
  if (rankDimensionKey !== undefined && !parseSemanticRankDimensionKey(rankDimensionKey)) invalid(`${field}.rankDimensionKey`);
  const instant = (name: string): string | undefined => {
    const value = input[name]; if (value === undefined) return undefined;
    if (typeof value !== "string" || value.length !== 24 || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) invalid(`${field}.${name}`);
    return value;
  };
  const rankCheckedFrom = instant("rankCheckedFrom"), rankCheckedBefore = instant("rankCheckedBefore");
  if (rankCheckedFrom && rankCheckedBefore && rankCheckedFrom >= rankCheckedBefore) invalid(`${field}.rankCheckedFrom`);
  if (!rankDimensionKey && (rankState || rankPositionMin || rankPositionMax || rankCheckedFrom || rankCheckedBefore)) invalid(`${field}.rankDimensionKey`);
  if ((rankState === "NOT_CHECKED" && (rankPositionMin || rankPositionMax || rankCheckedFrom || rankCheckedBefore)) || (rankState === "NOT_FOUND" && (rankPositionMin || rankPositionMax))) invalid(`${field}.rankState`);
  return {
    ...(baseMin ? { frequencyBaseMin: baseMin } : {}), ...(baseMax ? { frequencyBaseMax: baseMax } : {}),
    ...(exactMin ? { frequencyExactMin: exactMin } : {}), ...(exactMax ? { frequencyExactMax: exactMax } : {}),
    ...(fixedMin ? { frequencyFixedMin: fixedMin } : {}), ...(fixedMax ? { frequencyFixedMax: fixedMax } : {}),
    ...(wordCountMin ? { wordCountMin } : {}), ...(wordCountMax ? { wordCountMax } : {}), ...(targetUrlState ? { targetUrlState } : {}), ...(multipleUrlsState ? { multipleUrlsState } : {}),
    ...(typeof rankDimensionKey === "string" ? { rankDimensionKey } : {}), ...(rankState ? { rankState } : {}),
    ...(rankPositionMin ? { rankPositionMin } : {}), ...(rankPositionMax ? { rankPositionMax } : {}),
    ...(rankCheckedFrom ? { rankCheckedFrom } : {}), ...(rankCheckedBefore ? { rankCheckedBefore } : {})
  };
}

function requiredColumns(
  value: unknown,
  field = "config.columns"
): SemanticSavedViewConfig["columns"] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > (field === "config.columnOrder" ? semanticSavedViewColumnOrderLimit : 128)
  ) {
    invalid(field);
  }
  const columns = value.map((column, index) => {
    if (
      typeof column !== "string" ||
      (!semanticSystemColumnKeys.includes(
        column as (typeof semanticSystemColumnKeys)[number]
      ) && !parseSemanticRankColumnKey(column) &&
        !/^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          column
        ))
    ) {
      invalid(`${field}[${index}]`);
    }
    return column as SemanticSavedViewConfig["columns"][number];
  });
  if (new Set(columns).size !== columns.length || !columns.includes("query")) {
    invalid(field);
  }
  return columns;
}

function optionalColumnOrder(
  value: unknown,
  columns: SemanticSavedViewConfig["columns"]
): SemanticSavedViewConfig["columnOrder"] | undefined {
  if (value === undefined) return undefined;
  const columnOrder = requiredColumns(value, "config.columnOrder");
  if (columns.some((column) => !columnOrder.includes(column))) {
    invalid("config.columnOrder");
  }
  return columnOrder;
}

function optionalColumnWidths(
  value: unknown,
  columns: SemanticSavedViewConfig["columns"]
): SemanticSavedViewConfig["columnWidths"] | undefined {
  if (value === undefined) return undefined;
  const input = exactRecord(value, columns);
  const result: Record<string, number> = {};
  for (const [key, width] of Object.entries(input)) {
    if (!Number.isSafeInteger(width) || Number(width) < 56 || Number(width) > 1_200) {
      invalid(`config.columnWidths.${key}`);
    }
    result[key] = Number(width);
  }
  return result as SemanticSavedViewConfig["columnWidths"];
}

function optionalUuidArray(
  value: unknown,
  maximum: number
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maximum) invalid("config.groups");
  const values = value.map((item) => uuid(item, "config.groups"));
  if (new Set(values).size !== values.length) invalid("config.groups");
  return values;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid(field);
  return value;
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

function optionalInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
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

function requiredNumberMember<T extends number>(
  value: unknown,
  values: readonly T[],
  field: string
): T {
  if (typeof value !== "number" || !values.includes(value as T)) invalid(field);
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
