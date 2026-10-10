import { isSemanticRankDimensionSort, parseSemanticRankColumnKey, parseSemanticRankDimensionKey, semanticCompetitorRowColumnKeys } from "@seo-platform/contracts";
import {
  semanticCompetitorExportColumnKeys,
  semanticExportFormats,
  semanticExportLocales,
  semanticExportScopes,
  semanticKeywordIntents,
  semanticKeywordSorts,
  semanticPositionHistorySearchEngines,
  semanticSystemColumnKeys,
  type CreateSemanticExportInput,
  type SemanticExportColumnKey,
  type SemanticExportFilters,
  type SemanticFolderMapExportOptions,
  type SemanticPositionHistoryExportOptions,
  type SemanticPositionHistorySearchEngine
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";
import { keywordListQuery } from "./keyword-query.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CUSTOM_COLUMN_PATTERN =
  /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createSemanticExportInput(
  value: unknown
): CreateSemanticExportInput {
  const input = exactRecord(
    value,
    [
      "format",
      "scope",
      "locale",
      "columns",
      "filters",
      "sort",
      "rankSortDimensionKey",
      "keywordIds",
      "includeBom",
      "competitorRows",
      "positionHistory",
      "folderMap"
    ],
    "$"
  );
  const scope = requiredEnum(input.scope, semanticExportScopes, "scope");
  const format = requiredEnum(input.format, semanticExportFormats, "format");
  const filters =
    input.filters === undefined
      ? undefined
      : exportFilters(input.filters);
  const keywordIds =
    input.keywordIds === undefined
      ? undefined
      : exportKeywordIds(input.keywordIds);
  const columns = exportColumns(input.columns);
  const positionHistory = input.positionHistory === undefined
    ? undefined
    : positionHistoryOptions(input.positionHistory);
  const folderMap = input.folderMap === undefined
    ? undefined
    : folderMapOptions(input.folderMap);
  const sort = input.sort === undefined
    ? undefined
    : requiredEnum(input.sort, semanticKeywordSorts, "sort");
  const rankSortDimensionKey = input.rankSortDimensionKey;
  if (
    rankSortDimensionKey !== undefined &&
    !parseSemanticRankDimensionKey(rankSortDimensionKey)
  ) {
    invalid("rankSortDimensionKey", "Must identify a known rank dimension");
  }
  if (
    (sort !== undefined && isSemanticRankDimensionSort(sort)) !==
    Boolean(rankSortDimensionKey)
  ) {
    invalid(
      "rankSortDimensionKey",
      "Geographic rank sorting requires exactly one rank dimension"
    );
  }

  if (
    (scope === "SELECTED" || scope === "CURRENT_PAGE") &&
    keywordIds === undefined
  ) {
    invalid("keywordIds", "Selected and current-page exports require IDs");
  }
  if (
    scope !== "SELECTED" &&
    scope !== "CURRENT_PAGE" &&
    keywordIds !== undefined
  ) {
    invalid("keywordIds", "IDs are not supported for this export scope");
  }
  if (scope === "GROUP_SUBTREE" && !filters?.groupId) {
    invalid(
      "filters.groupId",
      "Group subtree export requires a group identifier"
    );
  }
  if (scope === "FULL_CORE" && filters !== undefined) {
    invalid("filters", "Full-core export does not accept filters");
  }
  if (positionHistory && format !== "XLSX") {
    invalid("format", "Position history report is available only as XLSX");
  }
  if ((scope === "FOLDER_MAP") !== Boolean(folderMap)) {
    invalid("folderMap", "Folder-map scope requires folder-map options");
  }
  if (folderMap && format !== "XLSX") {
    invalid("format", "Folder map is available only as XLSX");
  }
  if (folderMap && (filters !== undefined || positionHistory !== undefined)) {
    invalid("folderMap", "Folder map cannot be combined with filters or position history");
  }
  if (folderMap && !columns.includes("query")) {
    invalid("columns", "Folder map must include the query column");
  }

  if (input.competitorRows === true && (folderMap || positionHistory)) invalid("competitorRows", "Choose one export layout");
  return {
    format,
    scope,
    locale: requiredEnum(input.locale, semanticExportLocales, "locale"),
    columns,
    ...(filters ? { filters } : {}),
    ...(sort === undefined ? {} : { sort }),
    ...(typeof rankSortDimensionKey === "string"
      ? { rankSortDimensionKey }
      : {}),
    ...(keywordIds ? { keywordIds } : {}),
    ...(input.includeBom === undefined
      ? {}
      : { includeBom: requiredBoolean(input.includeBom, "includeBom") }),
    ...(input.competitorRows === undefined ? {} : { competitorRows: requiredBoolean(input.competitorRows, "competitorRows") }),
    ...(positionHistory ? { positionHistory } : {}),
    ...(folderMap ? { folderMap } : {})
  };
}

function folderMapOptions(value: unknown): SemanticFolderMapExportOptions {
  const input = exactRecord(
    value,
    ["groupIds", "includeDescendants"],
    "folderMap"
  );
  return {
    groupIds: requiredUuidList(input.groupIds, "folderMap.groupIds", 5_000),
    includeDescendants: requiredBoolean(
      input.includeDescendants,
      "folderMap.includeDescendants"
    )
  };
}

function positionHistoryOptions(
  value: unknown
): SemanticPositionHistoryExportOptions {
  const input = exactRecord(
    value,
    [
      "observedFrom",
      "observedBefore",
      "searchEngines",
      "dimensionKeys",
      "includeAllKeywords"
    ],
    "positionHistory"
  );
  const observedFrom = canonicalInstant(
    input.observedFrom,
    "positionHistory.observedFrom"
  );
  const observedBefore = canonicalInstant(
    input.observedBefore,
    "positionHistory.observedBefore"
  );
  const duration = Date.parse(observedBefore) - Date.parse(observedFrom);
  if (duration <= 0 || duration > 1_100 * 24 * 60 * 60 * 1_000) {
    invalid(
      "positionHistory.observedBefore",
      "Date interval must be positive and no longer than 1100 days"
    );
  }
  if (
    !Array.isArray(input.searchEngines) ||
    input.searchEngines.length < 1 ||
    input.searchEngines.length > semanticPositionHistorySearchEngines.length
  ) {
    invalid("positionHistory.searchEngines", "Select at least one search engine");
  }
  const searchEngines = input.searchEngines.map((engine, index) =>
    requiredEnum(
      engine,
      semanticPositionHistorySearchEngines,
      `positionHistory.searchEngines[${index}]`
    )
  );
  if (new Set(searchEngines).size !== searchEngines.length) {
    invalid("positionHistory.searchEngines", "Search engines must be unique");
  }
  const dimensionKeys = input.dimensionKeys === undefined
    ? undefined
    : positionHistoryDimensionKeys(input.dimensionKeys, searchEngines);
  if (
    input.includeAllKeywords !== undefined &&
    typeof input.includeAllKeywords !== "boolean"
  ) {
    invalid("positionHistory.includeAllKeywords", "Must be a boolean");
  }
  return {
    observedFrom,
    observedBefore,
    searchEngines,
    ...(dimensionKeys ? { dimensionKeys } : {}),
    ...(input.includeAllKeywords === true ? { includeAllKeywords: true } : {})
  };
}

function positionHistoryDimensionKeys(
  value: unknown,
  searchEngines: readonly SemanticPositionHistorySearchEngine[]
): readonly string[] {
  if (!Array.isArray(value) || value.length !== searchEngines.length) {
    invalid("positionHistory.dimensionKeys", "Select one city and device per search engine");
  }
  const dimensions = value.map((key, index) => {
    const dimension = parseSemanticRankDimensionKey(key);
    if (!dimension || !searchEngines.includes(dimension.searchEngine)) {
      invalid(`positionHistory.dimensionKeys[${index}]`, "Invalid rank dimension");
    }
    return dimension;
  });
  if (
    new Set(dimensions.map(({ key }) => key)).size !== dimensions.length ||
    new Set(dimensions.map(({ searchEngine }) => searchEngine)).size !==
      searchEngines.length
  ) {
    invalid("positionHistory.dimensionKeys", "Select one city and device per search engine");
  }
  return dimensions.map(({ key }) => key);
}

function exportFilters(value: unknown): SemanticExportFilters {
  const input = exactRecord(
    value,
    [
      "search",
      "tag",
      "intent",
      "groupId",
      "groupIds",
      "clusterId",
      "isFavorite",
      "isTracked",
      "priorityMin",
      "priorityMax"
      , "frequencyBaseMin", "frequencyBaseMax", "frequencyExactMin", "frequencyExactMax",
      "frequencyFixedMin", "frequencyFixedMax", "wordCountMin", "wordCountMax", "targetUrlState", "multipleUrlsState",
      "rankDimensionKey", "rankState", "rankPositionMin", "rankPositionMax", "rankCheckedFrom", "rankCheckedBefore"
    ],
    "filters"
  );
  const search = optionalString(input.search, "filters.search", 200);
  const tag = optionalString(input.tag, "filters.tag", 160)
    ?.toLocaleLowerCase();
  const intent =
    input.intent === undefined
      ? undefined
      : requiredEnum(input.intent, semanticKeywordIntents, "filters.intent");
  const groupId = optionalUuid(input.groupId, "filters.groupId");
  const groupIds = optionalUuidList(input.groupIds, "filters.groupIds", 2_000);
  if (groupId && groupIds) {
    invalid("filters.groupIds", "Cannot be combined with groupId");
  }
  const clusterId = optionalUuid(input.clusterId, "filters.clusterId");
  const isFavorite = optionalBoolean(
    input.isFavorite,
    "filters.isFavorite"
  );
  const isTracked = optionalBoolean(input.isTracked, "filters.isTracked");
  const priorityMin = optionalPriority(
    input.priorityMin,
    "filters.priorityMin"
  );
  const priorityMax = optionalPriority(
    input.priorityMax,
    "filters.priorityMax"
  );
  const advancedInput = Object.fromEntries([
    "frequencyBaseMin", "frequencyBaseMax", "frequencyExactMin", "frequencyExactMax", "frequencyFixedMin", "frequencyFixedMax",
    "wordCountMin", "wordCountMax", "targetUrlState", "multipleUrlsState", "rankDimensionKey", "rankState", "rankPositionMin", "rankPositionMax",
    "rankCheckedFrom", "rankCheckedBefore"
  ].flatMap(field => input[field] === undefined ? [] : [[field, String(input[field])]]));
  const { limit: _limit, sort: _sort, ...advanced } = keywordListQuery({ limit: "1", sort: "CREATED_DESC", ...advancedInput });
  void _limit; void _sort;
  if (
    priorityMin !== undefined &&
    priorityMax !== undefined &&
    priorityMin > priorityMax
  ) {
    invalid(
      "filters.priorityMin",
      "Must not be greater than priorityMax"
    );
  }
  return {
    ...(search ? { search } : {}),
    ...(tag ? { tag } : {}),
    ...(intent ? { intent } : {}),
    ...(groupId ? { groupId } : {}),
    ...(groupIds ? { groupIds } : {}),
    ...(clusterId ? { clusterId } : {}),
    ...(isFavorite === undefined ? {} : { isFavorite }),
    ...(isTracked === undefined ? {} : { isTracked }),
    ...(priorityMin === undefined ? {} : { priorityMin }),
    ...(priorityMax === undefined ? {} : { priorityMax }),
    ...advanced
  };
}

function optionalUuidList(
  value: unknown,
  field: string,
  maximum: number
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 2 || value.length > maximum) {
    invalid(field, `Must contain 2 to ${maximum} UUIDs`);
  }
  const values = value.map((item, index) => {
    if (typeof item !== "string" || !UUID_PATTERN.test(item)) {
      invalid(`${field}[${index}]`, "Must be a UUID");
    }
    return item.toLowerCase();
  });
  if (new Set(values).size !== values.length) {
    invalid(field, "Must contain unique UUIDs");
  }
  return [...values].sort();
}

function requiredUuidList(
  value: unknown,
  field: string,
  maximum: number
): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    invalid(field, `Must contain 1 to ${maximum} UUIDs`);
  }
  const values = value.map((item, index) => {
    if (typeof item !== "string" || !UUID_PATTERN.test(item)) {
      invalid(`${field}[${index}]`, "Must be a UUID");
    }
    return item.toLowerCase();
  });
  if (new Set(values).size !== values.length) {
    invalid(field, "Must contain unique UUIDs");
  }
  return values;
}

function exportColumns(
  value: unknown
): readonly SemanticExportColumnKey[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 112) {
    invalid("columns", "Must contain 1 to 112 columns");
  }
  const columns = value.map((column, index) => {
    if (
      typeof column !== "string" ||
      (!semanticSystemColumnKeys.includes(
        column as (typeof semanticSystemColumnKeys)[number]
      ) && !semanticCompetitorExportColumnKeys.includes(
        column as (typeof semanticCompetitorExportColumnKeys)[number]
      ) &&
        !CUSTOM_COLUMN_PATTERN.test(column) && !parseSemanticRankColumnKey(column) && !semanticCompetitorRowColumnKeys.includes(column as typeof semanticCompetitorRowColumnKeys[number]))
    ) {
      invalid(`columns[${index}]`, "Must be a known column key");
    }
    return (column.startsWith("custom:")
      ? `custom:${column.slice("custom:".length).toLowerCase()}`
      : column) as SemanticExportColumnKey;
  });
  if (new Set(columns).size !== columns.length) {
    invalid("columns", "Columns must be unique");
  }
  return columns;
}

function exportKeywordIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 15_000) {
    invalid("keywordIds", "Must contain 1 to 15000 keyword IDs");
  }
  const ids = value.map((item, index) => {
    if (typeof item !== "string" || !UUID_PATTERN.test(item)) {
      invalid(`keywordIds[${index}]`, "Must be a UUID");
    }
    return item.toLowerCase();
  });
  if (new Set(ids).size !== ids.length) {
    invalid("keywordIds", "Keyword IDs must be unique");
  }
  return ids;
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

function canonicalInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length !== 24) {
    invalid(field, "Must be a canonical ISO timestamp");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    invalid(field, "Must be a canonical ISO timestamp");
  }
  return value;
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
  return requiredBoolean(value, field);
}

function requiredBoolean(value: unknown, field: string): boolean {
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
  throw validationError(path, "INVALID_SEMANTIC_EXPORT", message);
}
