import { isSemanticRankDimensionSort, parseSemanticRankColumnKey, parseSemanticRankDimensionKey, semanticCompetitorRowColumnKeys } from "@seo-platform/contracts";
import { BadRequestException } from "@nestjs/common";
import {
  semanticCompetitorExportColumnKeys,
  semanticExportFormats,
  semanticExportLocales,
  semanticExportScopes,
  semanticKeywordIntents,
  semanticKeywordSorts,
  semanticPositionHistorySearchEngines,
  semanticSystemColumnKeys,
  type InternalCancelSemanticExportInput,
  type InternalCreateSemanticExportInput,
  type SemanticExportColumnKey
} from "@seo-platform/contracts";
import type { Job } from "../generated/prisma/client.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY = /^[A-Za-z0-9._:-]{8,180}$/u;
const CUSTOM_COLUMN = /^custom:[0-9a-f-]{36}$/iu;
const EXPORT_COLUMNS = new Set<string>([
  ...semanticSystemColumnKeys,
  ...semanticCompetitorExportColumnKeys,
  ...semanticCompetitorRowColumnKeys
]);
const CREATE_FIELDS = new Set([
  "workspaceId",
  "projectId",
  "actorId",
  "idempotencyKey",
  "correlationId",
  "jobCapacity",
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
]);
const CAPACITY_FIELDS = new Set([
  "planCode",
  "planVersion",
  "concurrentJobs"
]);
const CANCEL_FIELDS = new Set([
  "workspaceId",
  "projectId",
  "actorId",
  "version"
]);
const FILTER_FIELDS = new Set([
  "search",
  "tag",
  "intent",
  "groupId",
  "groupIds",
  "clusterId",
  "isFavorite",
  "isTracked",
  "priorityMin",
  "priorityMax",
  "frequencyBaseMin", "frequencyBaseMax", "frequencyExactMin", "frequencyExactMax",
  "frequencyFixedMin", "frequencyFixedMax", "wordCountMin", "wordCountMax", "targetUrlState",
  "rankDimensionKey", "rankState", "rankPositionMin", "rankPositionMax", "rankCheckedFrom", "rankCheckedBefore"
]);

export function internalCreateSemanticExportInput(value: unknown): InternalCreateSemanticExportInput {
  const input = exactRecord(value, CREATE_FIELDS, "body");
  const format = enumValue(input.format, semanticExportFormats, "format");
  const scope = enumValue(input.scope, semanticExportScopes, "scope");
  const locale = enumValue(input.locale, semanticExportLocales, "locale");
  if (!Array.isArray(input.columns) || input.columns.length < 1 || input.columns.length > 112) invalid("columns");
  const columns = input.columns.map((column) => {
    if (typeof column !== "string" || (!EXPORT_COLUMNS.has(column) && !CUSTOM_COLUMN.test(column) && !parseSemanticRankColumnKey(column))) invalid("columns");
    return (column.startsWith("custom:")
      ? `custom:${column.slice("custom:".length).toLowerCase()}`
      : column) as SemanticExportColumnKey;
  });
  if (new Set(columns).size !== columns.length) invalid("columns");
  const filters = input.filters === undefined ? undefined : exportFilters(input.filters);
  const keywordIds = input.keywordIds === undefined ? undefined : uuidList(input.keywordIds, "keywordIds", 15_000);
  const positionHistory = input.positionHistory === undefined
    ? undefined
    : positionHistoryOptions(input.positionHistory);
  const folderMap = input.folderMap === undefined
    ? undefined
    : folderMapOptions(input.folderMap);
  const sort = input.sort === undefined
    ? undefined
    : enumValue(input.sort, semanticKeywordSorts, "sort");
  const rankSortDimensionKey = input.rankSortDimensionKey;
  if (
    rankSortDimensionKey !== undefined &&
    !parseSemanticRankDimensionKey(rankSortDimensionKey)
  ) {
    invalid("rankSortDimensionKey");
  }
  if (
    (sort !== undefined && isSemanticRankDimensionSort(sort)) !==
    Boolean(rankSortDimensionKey)
  ) {
    invalid("rankSortDimensionKey");
  }
  if ((scope === "SELECTED" || scope === "CURRENT_PAGE") !== Boolean(keywordIds)) invalid("keywordIds");
  if (scope === "GROUP_SUBTREE" && !filters?.groupId) invalid("filters.groupId");
  if (scope === "FULL_CORE" && filters) invalid("filters");
  if (positionHistory && format !== "XLSX") invalid("format");
  if ((scope === "FOLDER_MAP") !== Boolean(folderMap)) invalid("folderMap");
  if (folderMap && format !== "XLSX") invalid("format");
  if (folderMap && (filters || positionHistory)) invalid("folderMap");
  if (folderMap && !columns.includes("query")) invalid("columns");
  if (input.competitorRows === true && (folderMap || positionHistory)) invalid("competitorRows");
  const capacity = exactRecord(input.jobCapacity, CAPACITY_FIELDS, "jobCapacity");
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    idempotencyKey: pattern(input.idempotencyKey, KEY, "idempotencyKey"),
    correlationId: bounded(input.correlationId, 100, "correlationId"),
    jobCapacity: {
      planCode: bounded(capacity.planCode, 64, "jobCapacity.planCode"),
      planVersion: integer(capacity.planVersion, 1, "jobCapacity.planVersion"),
      concurrentJobs: integer(capacity.concurrentJobs, 1, "jobCapacity.concurrentJobs")
    },
    format,
    scope,
    locale,
    columns,
    ...(filters ? { filters } : {}),
    ...(sort === undefined ? {} : { sort }),
    ...(typeof rankSortDimensionKey === "string"
      ? { rankSortDimensionKey }
      : {}),
    ...(keywordIds ? { keywordIds } : {}),
    ...(input.includeBom === undefined ? {} : { includeBom: booleanValue(input.includeBom, "includeBom") }),
    ...(input.competitorRows === undefined ? {} : { competitorRows: booleanValue(input.competitorRows, "competitorRows") }),
    ...(positionHistory ? { positionHistory } : {}),
    ...(folderMap ? { folderMap } : {})
  };
}

function folderMapOptions(
  value: unknown
): NonNullable<InternalCreateSemanticExportInput["folderMap"]> {
  const input = exactRecord(
    value,
    new Set(["groupIds", "includeDescendants"]),
    "folderMap"
  );
  return {
    groupIds: uuidList(input.groupIds, "folderMap.groupIds", 5_000),
    includeDescendants: booleanValue(
      input.includeDescendants,
      "folderMap.includeDescendants"
    )
  };
}

function positionHistoryOptions(
  value: unknown
): NonNullable<InternalCreateSemanticExportInput["positionHistory"]> {
  const input = exactRecord(
    value,
    new Set(["observedFrom", "observedBefore", "searchEngines", "dimensionKeys"]),
    "positionHistory"
  );
  const observedFrom = canonicalInstant(input.observedFrom, "positionHistory.observedFrom");
  const observedBefore = canonicalInstant(input.observedBefore, "positionHistory.observedBefore");
  const duration = Date.parse(observedBefore) - Date.parse(observedFrom);
  if (duration <= 0 || duration > 1_100 * 24 * 60 * 60 * 1_000) {
    invalid("positionHistory.observedBefore");
  }
  if (
    !Array.isArray(input.searchEngines) ||
    input.searchEngines.length < 1 ||
    input.searchEngines.length > semanticPositionHistorySearchEngines.length
  ) {
    invalid("positionHistory.searchEngines");
  }
  const searchEngines = input.searchEngines.map((engine) =>
    enumValue(engine, semanticPositionHistorySearchEngines, "positionHistory.searchEngines")
  );
  if (new Set(searchEngines).size !== searchEngines.length) {
    invalid("positionHistory.searchEngines");
  }
  let dimensionKeys: readonly string[] | undefined;
  if (input.dimensionKeys !== undefined) {
    if (!Array.isArray(input.dimensionKeys) || input.dimensionKeys.length !== searchEngines.length) {
      invalid("positionHistory.dimensionKeys");
    }
    const dimensions = input.dimensionKeys.map((key) => {
      const dimension = parseSemanticRankDimensionKey(key);
      if (!dimension || !searchEngines.includes(dimension.searchEngine)) {
        invalid("positionHistory.dimensionKeys");
      }
      return dimension;
    });
    if (
      new Set(dimensions.map(({ key }) => key)).size !== dimensions.length ||
      new Set(dimensions.map(({ searchEngine }) => searchEngine)).size !== searchEngines.length
    ) {
      invalid("positionHistory.dimensionKeys");
    }
    dimensionKeys = dimensions.map(({ key }) => key);
  }
  return {
    observedFrom,
    observedBefore,
    searchEngines,
    ...(dimensionKeys ? { dimensionKeys } : {})
  };
}

export function internalCancelSemanticExportInput(value: unknown): InternalCancelSemanticExportInput {
  const input = exactRecord(value, CANCEL_FIELDS, "body");
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    version: integer(input.version, 1, "version")
  };
}

export function storedSemanticExportInput(
  job: Pick<
    Job,
    "actorId" | "correlationId" | "id" | "inputSnapshot" | "projectId" | "workspaceId"
  >
): InternalCreateSemanticExportInput {
  if (!job.actorId || !job.projectId) invalid("stored tenant context");
  return internalCreateSemanticExportInput({
    ...record(job.inputSnapshot),
    workspaceId: job.workspaceId,
    projectId: job.projectId,
    actorId: job.actorId,
    idempotencyKey: `stored-${job.id}`,
    correlationId: job.correlationId,
    jobCapacity: {
      planCode: "stored-export",
      planVersion: 1,
      concurrentJobs: 1
    }
  });
}

function exportFilters(value: unknown): NonNullable<InternalCreateSemanticExportInput["filters"]> {
  const input = exactRecord(value, FILTER_FIELDS, "filters");
  const priorityMin = optionalInteger(input.priorityMin, "filters.priorityMin");
  const priorityMax = optionalInteger(input.priorityMax, "filters.priorityMax");
  const search = optionalBounded(input.search, 200, "filters.search");
  const tag = optionalBounded(input.tag, 160, "filters.tag");
  const groupId = input.groupId === undefined
    ? undefined
    : uuid(input.groupId, "filters.groupId");
  const groupIds = input.groupIds === undefined
    ? undefined
    : uuidList(input.groupIds, "filters.groupIds", 2_000);
  if (groupIds && groupIds.length < 2) invalid("filters.groupIds");
  if (groupId && groupIds) invalid("filters.groupIds");
  if (priorityMin !== undefined && priorityMax !== undefined && priorityMin > priorityMax) invalid("filters.priorityMin");
  const advanced = advancedExportFilters(input);
  return {
    ...(search ? { search } : {}),
    ...(tag ? { tag: tag.toLocaleLowerCase() } : {}),
    ...(input.intent === undefined ? {} : { intent: enumValue(input.intent, semanticKeywordIntents, "filters.intent") }),
    ...(groupId ? { groupId } : {}),
    ...(groupIds ? { groupIds: [...groupIds].sort() } : {}),
    ...(input.clusterId === undefined ? {} : { clusterId: uuid(input.clusterId, "filters.clusterId") }),
    ...(input.isFavorite === undefined ? {} : { isFavorite: booleanValue(input.isFavorite, "filters.isFavorite") }),
    ...(input.isTracked === undefined ? {} : { isTracked: booleanValue(input.isTracked, "filters.isTracked") }),
    ...(priorityMin === undefined ? {} : { priorityMin }),
    ...(priorityMax === undefined ? {} : { priorityMax }),
    ...advanced
  };
}

function advancedExportFilters(input: Readonly<Record<string, unknown>>) {
  const decimal = (name: string): string | undefined => { const value = input[name]; if (value === undefined) return undefined; if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,18})$/u.test(value) || BigInt(value) > 9_223_372_036_854_775_807n) invalid(`filters.${name}`); return value; };
  const number = (name: string, max: number): number | undefined => { const value = input[name]; if (value === undefined) return undefined; if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) invalid(`filters.${name}`); return Number(value); };
  const baseMin = decimal("frequencyBaseMin"), baseMax = decimal("frequencyBaseMax"), exactMin = decimal("frequencyExactMin"), exactMax = decimal("frequencyExactMax"), fixedMin = decimal("frequencyFixedMin"), fixedMax = decimal("frequencyFixedMax");
  for (const [min, max, name] of [[baseMin, baseMax, "frequencyBaseMin"], [exactMin, exactMax, "frequencyExactMin"], [fixedMin, fixedMax, "frequencyFixedMin"]] as const) if (min && max && BigInt(min) > BigInt(max)) invalid(`filters.${name}`);
  const wordCountMin = number("wordCountMin", 10_000), wordCountMax = number("wordCountMax", 10_000), rankPositionMin = number("rankPositionMin", 100), rankPositionMax = number("rankPositionMax", 100);
  if ((wordCountMin && wordCountMax && wordCountMin > wordCountMax) || (rankPositionMin && rankPositionMax && rankPositionMin > rankPositionMax)) invalid("filters.range");
  const targetUrlState = input.targetUrlState === undefined ? undefined : enumValue(input.targetUrlState, ["SET", "EMPTY"] as const, "filters.targetUrlState");
  const rankState = input.rankState === undefined ? undefined : enumValue(input.rankState, ["CHECKED", "FOUND", "NOT_FOUND", "NOT_CHECKED"] as const, "filters.rankState");
  const rankDimensionKey = input.rankDimensionKey;
  if (rankDimensionKey !== undefined && !parseSemanticRankDimensionKey(rankDimensionKey)) invalid("filters.rankDimensionKey");
  const rankCheckedFrom = input.rankCheckedFrom === undefined ? undefined : canonicalInstant(input.rankCheckedFrom, "filters.rankCheckedFrom");
  const rankCheckedBefore = input.rankCheckedBefore === undefined ? undefined : canonicalInstant(input.rankCheckedBefore, "filters.rankCheckedBefore");
  if (rankCheckedFrom && rankCheckedBefore && rankCheckedFrom >= rankCheckedBefore) invalid("filters.rankCheckedFrom");
  if (!rankDimensionKey && (rankState || rankPositionMin || rankPositionMax || rankCheckedFrom || rankCheckedBefore)) invalid("filters.rankDimensionKey");
  if ((rankState === "NOT_CHECKED" && (rankPositionMin || rankPositionMax || rankCheckedFrom || rankCheckedBefore)) || (rankState === "NOT_FOUND" && (rankPositionMin || rankPositionMax))) invalid("filters.rankState");
  return { ...(baseMin ? { frequencyBaseMin: baseMin } : {}), ...(baseMax ? { frequencyBaseMax: baseMax } : {}), ...(exactMin ? { frequencyExactMin: exactMin } : {}), ...(exactMax ? { frequencyExactMax: exactMax } : {}), ...(fixedMin ? { frequencyFixedMin: fixedMin } : {}), ...(fixedMax ? { frequencyFixedMax: fixedMax } : {}), ...(wordCountMin ? { wordCountMin } : {}), ...(wordCountMax ? { wordCountMax } : {}), ...(targetUrlState ? { targetUrlState } : {}), ...(typeof rankDimensionKey === "string" ? { rankDimensionKey } : {}), ...(rankState ? { rankState } : {}), ...(rankPositionMin ? { rankPositionMin } : {}), ...(rankPositionMax ? { rankPositionMax } : {}), ...(rankCheckedFrom ? { rankCheckedFrom } : {}), ...(rankCheckedBefore ? { rankCheckedBefore } : {}) };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("body");
  return value as Readonly<Record<string, unknown>>;
}
function exactRecord(value: unknown, allowed: ReadonlySet<string>, field: string): Readonly<Record<string, unknown>> {
  const input = record(value);
  if (Object.keys(input).some((key) => !allowed.has(key))) invalid(field);
  return input;
}
function enumValue<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) invalid(field);
  return value as T;
}
function uuid(value: unknown, field: string): string { return pattern(value, UUID, field).toLowerCase(); }
function pattern(value: unknown, regex: RegExp, field: string): string { if (typeof value !== "string" || !regex.test(value)) invalid(field); return value; }
function bounded(value: unknown, max: number, field: string): string { if (typeof value !== "string" || !value.trim() || value.length > max) invalid(field); return value.trim(); }
function optionalBounded(value: unknown, max: number, field: string): string | undefined { return value === undefined ? undefined : bounded(value, max, field); }
function integer(value: unknown, min: number, field: string): number { if (!Number.isSafeInteger(value) || Number(value) < min) invalid(field); return Number(value); }
function optionalInteger(value: unknown, field: string): number | undefined { if (value === undefined) return undefined; const result = integer(value, 0, field); if (result > 100) invalid(field); return result; }
function booleanValue(value: unknown, field: string): boolean { if (typeof value !== "boolean") invalid(field); return value; }
function uuidList(value: unknown, field: string, max: number): readonly string[] { if (!Array.isArray(value) || value.length < 1 || value.length > max) invalid(field); const ids = value.map((item) => uuid(item, field)); if (new Set(ids).size !== ids.length) invalid(field); return ids; }
function canonicalInstant(value: unknown, field: string): string { if (typeof value !== "string" || value.length !== 24) invalid(field); const parsed = new Date(value); if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) invalid(field); return value; }
function invalid(field: string): never { throw new BadRequestException(`Invalid semantic export ${field}`); }
