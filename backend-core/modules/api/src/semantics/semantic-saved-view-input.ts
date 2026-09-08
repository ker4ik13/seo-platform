import { isSemanticRankDimensionSort, parseSemanticRankColumnKey, parseSemanticRankDimensionKey } from "@seo-platform/contracts";
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
  semanticSystemColumnKeys,
  type CreateSemanticSavedViewInput,
  type SemanticSavedViewConfig,
  type SemanticSavedViewFilters,
  type UpdateSemanticSavedViewInput
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createSemanticSavedViewInput(
  value: unknown
): CreateSemanticSavedViewInput {
  const input = exactRecord(value, ["name", "scope", "config"], "$");
  return {
    name: viewName(input.name),
    scope: requiredEnum(
      input.scope,
      semanticSavedViewScopes,
      "scope"
    ),
    config: savedViewConfig(input.config)
  };
}

export function updateSemanticSavedViewInput(
  value: unknown
): UpdateSemanticSavedViewInput {
  const input = exactRecord(value, ["name", "config"], "$");
  if (input.name === undefined && input.config === undefined) {
    invalid("$", "At least one field is required");
  }
  return {
    ...(input.name === undefined ? {} : { name: viewName(input.name) }),
    ...(input.config === undefined
      ? {}
      : { config: savedViewConfig(input.config) })
  };
}

export function savedViewConfig(value: unknown): SemanticSavedViewConfig {
  const input = exactRecord(
    value,
    [
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
    ],
    "config"
  );
  if (!semanticSavedViewSchemaVersions.some(
    (version) => version === input.schemaVersion
  )) {
    invalid("config.schemaVersion", "Unsupported schema version");
  }
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
  const expandedGroupIds = optionalUuidArray(
    input.expandedGroupIds,
    "config.expandedGroupIds",
    1_000
  );
  const selectedGroupIds = optionalUuidArray(
    input.selectedGroupIds,
    "config.selectedGroupIds",
    2_000
  );
  const sort = requiredEnum(input.sort, semanticKeywordSorts, "config.sort");
  const rankSortDimensionKey = input.rankSortDimensionKey;
  if (
    rankSortDimensionKey !== undefined &&
    !parseSemanticRankDimensionKey(rankSortDimensionKey)
  ) {
    invalid(
      "config.rankSortDimensionKey",
      "Must identify a known rank dimension"
    );
  }
  if (
    isSemanticRankDimensionSort(sort) !== Boolean(rankSortDimensionKey) ||
    (rankSortDimensionKey !== undefined && input.schemaVersion !== 4)
  ) {
    invalid(
      "config.rankSortDimensionKey",
      "Schema v4 geographic sorting requires exactly one rank dimension"
    );
  }
  const appliedViewId = optionalUuid(
    input.appliedViewId,
    "config.appliedViewId"
  );
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
    invalid(
      "config.queryIndicators",
      `Must contain at most ${semanticSavedViewQueryIndicators.length} indicators`
    );
  }
  const indicators = value.map((indicator, index) =>
    requiredEnum(
      indicator,
      semanticSavedViewQueryIndicators,
      `config.queryIndicators[${index}]`
    )
  );
  if (new Set(indicators).size !== indicators.length) {
    invalid("config.queryIndicators", "Must be unique");
  }
  return indicators;
}

function savedViewFilters(value: unknown): SemanticSavedViewFilters {
  const input = exactRecord(
    value,
    [
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
      "frequencyFixedMin", "frequencyFixedMax", "wordCountMin", "wordCountMax", "targetUrlState",
      "rankDimensionKey", "rankState", "rankPositionMin", "rankPositionMax", "rankCheckedFrom", "rankCheckedBefore"
    ],
    "config.filters"
  );
  const search = optionalString(input.search, "search", 200);
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
  const groupId = optionalUuid(input.groupId, "config.filters.groupId");
  const clusterId = optionalUuid(input.clusterId, "config.filters.clusterId");
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
  const advanced = advancedFilters(input);
  if (
    priorityMin !== undefined &&
    priorityMax !== undefined &&
    priorityMin > priorityMax
  ) {
    invalid(
      "config.filters.priorityMin",
      "Must not be greater than priorityMax"
    );
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

function advancedFilters(input: Readonly<Record<string, unknown>>): Omit<SemanticSavedViewFilters, "search" | "tag" | "intent" | "groupId" | "clusterId" | "isFavorite" | "isTracked" | "priorityMin" | "priorityMax"> {
  const bad = (name: string): never => invalid(`config.filters.${name}`, "Invalid advanced filter value");
  const decimal = (name: string): string | undefined => { const value = input[name]; if (value === undefined) return undefined; if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,18})$/u.test(value) || BigInt(value) > 9_223_372_036_854_775_807n) bad(name); return value as string; };
  const integer = (name: string, max: number): number | undefined => { const value = input[name]; if (value === undefined) return undefined; if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) bad(name); return Number(value); };
  const baseMin = decimal("frequencyBaseMin"), baseMax = decimal("frequencyBaseMax"), exactMin = decimal("frequencyExactMin"), exactMax = decimal("frequencyExactMax"), fixedMin = decimal("frequencyFixedMin"), fixedMax = decimal("frequencyFixedMax");
  for (const [min, max, name] of [[baseMin, baseMax, "frequencyBaseMin"], [exactMin, exactMax, "frequencyExactMin"], [fixedMin, fixedMax, "frequencyFixedMin"]] as const) if (min && max && BigInt(min) > BigInt(max)) bad(name);
  const wordCountMin = integer("wordCountMin", 10_000), wordCountMax = integer("wordCountMax", 10_000), rankPositionMin = integer("rankPositionMin", 100), rankPositionMax = integer("rankPositionMax", 100);
  if (wordCountMin && wordCountMax && wordCountMin > wordCountMax) bad("wordCountMin");
  if (rankPositionMin && rankPositionMax && rankPositionMin > rankPositionMax) bad("rankPositionMin");
  const targetUrlState = input.targetUrlState === undefined ? undefined : requiredEnum(input.targetUrlState, ["SET", "EMPTY"] as const, "config.filters.targetUrlState");
  const rankState = input.rankState === undefined ? undefined : requiredEnum(input.rankState, ["CHECKED", "FOUND", "NOT_FOUND", "NOT_CHECKED"] as const, "config.filters.rankState");
  const rankDimensionKey = input.rankDimensionKey;
  if (rankDimensionKey !== undefined && !parseSemanticRankDimensionKey(rankDimensionKey)) bad("rankDimensionKey");
  const instant = (name: string): string | undefined => { const value = input[name]; if (value === undefined) return undefined; if (typeof value !== "string" || value.length !== 24 || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) bad(name); return value as string; };
  const rankCheckedFrom = instant("rankCheckedFrom"), rankCheckedBefore = instant("rankCheckedBefore");
  if (rankCheckedFrom && rankCheckedBefore && rankCheckedFrom >= rankCheckedBefore) bad("rankCheckedFrom");
  if (!rankDimensionKey && (rankState || rankPositionMin || rankPositionMax || rankCheckedFrom || rankCheckedBefore)) bad("rankDimensionKey");
  if ((rankState === "NOT_CHECKED" && (rankPositionMin || rankPositionMax || rankCheckedFrom || rankCheckedBefore)) || (rankState === "NOT_FOUND" && (rankPositionMin || rankPositionMax))) bad("rankState");
  return { ...(baseMin ? { frequencyBaseMin: baseMin } : {}), ...(baseMax ? { frequencyBaseMax: baseMax } : {}), ...(exactMin ? { frequencyExactMin: exactMin } : {}), ...(exactMax ? { frequencyExactMax: exactMax } : {}), ...(fixedMin ? { frequencyFixedMin: fixedMin } : {}), ...(fixedMax ? { frequencyFixedMax: fixedMax } : {}), ...(wordCountMin ? { wordCountMin } : {}), ...(wordCountMax ? { wordCountMax } : {}), ...(targetUrlState ? { targetUrlState } : {}), ...(typeof rankDimensionKey === "string" ? { rankDimensionKey } : {}), ...(rankState ? { rankState } : {}), ...(rankPositionMin ? { rankPositionMin } : {}), ...(rankPositionMax ? { rankPositionMax } : {}), ...(rankCheckedFrom ? { rankCheckedFrom } : {}), ...(rankCheckedBefore ? { rankCheckedBefore } : {}) };
}

function requiredColumns(
  value: unknown,
  field = "config.columns"
): SemanticSavedViewConfig["columns"] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 128
  ) {
    invalid(field, "Must contain 1 to 128 columns");
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
      invalid(`${field}[${index}]`, "Must be a known column key");
    }
    return column as SemanticSavedViewConfig["columns"][number];
  });
  if (new Set(columns).size !== columns.length || !columns.includes("query")) {
    invalid(
      field,
      "Columns must be unique and include the query column"
    );
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
    invalid(
      "config.columnOrder",
      "Must include every visible column"
    );
  }
  return columnOrder;
}

function optionalColumnWidths(
  value: unknown,
  columns: SemanticSavedViewConfig["columns"]
): SemanticSavedViewConfig["columnWidths"] | undefined {
  if (value === undefined) return undefined;
  const input = exactRecord(value, columns, "config.columnWidths");
  const entries = Object.entries(input);
  if (entries.length > columns.length) invalid("config.columnWidths", "Too many widths");
  const result: Record<string, number> = {};
  for (const [key, width] of entries) {
    if (!Number.isSafeInteger(width) || Number(width) < 56 || Number(width) > 1_200) {
      invalid(`config.columnWidths.${key}`, "Must be an integer between 56 and 1200");
    }
    result[key] = Number(width);
  }
  return result as SemanticSavedViewConfig["columnWidths"];
}

function optionalUuidArray(
  value: unknown,
  field: string,
  maximum: number
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maximum) {
    invalid(field, `Must contain at most ${maximum} identifiers`);
  }
  const values = value.map((item, index) => {
    if (typeof item !== "string" || !UUID_PATTERN.test(item)) {
      invalid(`${field}[${index}]`, "Must be a UUID");
    }
    return item.toLowerCase();
  });
  if (new Set(values).size !== values.length) invalid(field, "Must be unique");
  return values;
}

function viewName(value: unknown): string {
  if (typeof value !== "string") invalid("name", "Must be a string");
  const name = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (!name || name.length > 160) {
    invalid("name", "Must contain 1 to 160 characters");
  }
  return name;
}

function optionalString(
  value: unknown,
  field: string,
  maxLength: number
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalid(field, "Must be a string");
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length > maxLength) {
    invalid(field, `Must contain at most ${maxLength} characters`);
  }
  return normalized || undefined;
}

function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    invalid(field, "Must be a UUID");
  }
  return value.toLowerCase();
}

function optionalBoolean(
  value: unknown,
  field: string
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") invalid(field, "Must be a boolean");
  return value;
}

function optionalPriority(
  value: unknown,
  field: string
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100) {
    invalid(field, "Must be an integer between 0 and 100");
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
    invalid(field, `Must be an integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
}

function requiredEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  field: string
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    invalid(field, `Must be one of: ${values.join(", ")}`);
  }
  return value as T;
}

function requiredNumberMember<T extends number>(
  value: unknown,
  values: readonly T[],
  field: string
): T {
  if (typeof value !== "number" || !values.includes(value as T)) {
    invalid(field, `Must be one of: ${values.join(", ")}`);
  }
  return value as T;
}

function exactRecord(
  value: unknown,
  allowed: readonly string[],
  field: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(field, "Must be a JSON object");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    invalid(field, "Contains unsupported fields");
  }
  return input;
}

function invalid(path: string, message: string): never {
  throw validationError(path, "INVALID_SAVED_VIEW", message);
}
