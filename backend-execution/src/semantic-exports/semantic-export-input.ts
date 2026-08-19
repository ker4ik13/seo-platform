import { BadRequestException } from "@nestjs/common";
import {
  semanticExportFormats,
  semanticExportLocales,
  semanticExportScopes,
  semanticKeywordIntents,
  semanticKeywordSorts,
  semanticPositionHistorySearchEngines,
  semanticSystemColumnKeys,
  type InternalCancelSemanticExportInput,
  type InternalCreateSemanticExportInput,
  type SemanticSavedViewColumnKey
} from "@seo-platform/contracts";
import type { Job } from "../generated/prisma/client.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY = /^[A-Za-z0-9._:-]{8,180}$/u;
const CUSTOM_COLUMN = /^custom:[0-9a-f-]{36}$/iu;
const SYSTEM_COLUMNS = new Set<string>(semanticSystemColumnKeys);
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
  "keywordIds",
  "includeBom",
  "positionHistory"
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
  "priorityMax"
]);

export function internalCreateSemanticExportInput(value: unknown): InternalCreateSemanticExportInput {
  const input = exactRecord(value, CREATE_FIELDS, "body");
  const format = enumValue(input.format, semanticExportFormats, "format");
  const scope = enumValue(input.scope, semanticExportScopes, "scope");
  const locale = enumValue(input.locale, semanticExportLocales, "locale");
  if (!Array.isArray(input.columns) || input.columns.length < 1 || input.columns.length > 108) invalid("columns");
  const columns = input.columns.map((column) => {
    if (typeof column !== "string" || (!SYSTEM_COLUMNS.has(column) && !CUSTOM_COLUMN.test(column))) invalid("columns");
    return (column.startsWith("custom:")
      ? `custom:${column.slice("custom:".length).toLowerCase()}`
      : column) as SemanticSavedViewColumnKey;
  });
  if (new Set(columns).size !== columns.length) invalid("columns");
  const filters = input.filters === undefined ? undefined : exportFilters(input.filters);
  const keywordIds = input.keywordIds === undefined ? undefined : uuidList(input.keywordIds, "keywordIds", 15_000);
  const positionHistory = input.positionHistory === undefined
    ? undefined
    : positionHistoryOptions(input.positionHistory);
  if ((scope === "SELECTED" || scope === "CURRENT_PAGE") !== Boolean(keywordIds)) invalid("keywordIds");
  if (scope === "GROUP_SUBTREE" && !filters?.groupId) invalid("filters.groupId");
  if (scope === "FULL_CORE" && filters) invalid("filters");
  if (positionHistory && format !== "XLSX") invalid("format");
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
    ...(input.sort === undefined ? {} : { sort: enumValue(input.sort, semanticKeywordSorts, "sort") }),
    ...(keywordIds ? { keywordIds } : {}),
    ...(input.includeBom === undefined ? {} : { includeBom: booleanValue(input.includeBom, "includeBom") }),
    ...(positionHistory ? { positionHistory } : {})
  };
}

function positionHistoryOptions(
  value: unknown
): NonNullable<InternalCreateSemanticExportInput["positionHistory"]> {
  const input = exactRecord(
    value,
    new Set(["observedFrom", "observedBefore", "searchEngines"]),
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
  return { observedFrom, observedBefore, searchEngines };
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
    : uuidList(input.groupIds, "filters.groupIds", 200);
  if (groupIds && groupIds.length < 2) invalid("filters.groupIds");
  if (groupId && groupIds) invalid("filters.groupIds");
  if (priorityMin !== undefined && priorityMax !== undefined && priorityMin > priorityMax) invalid("filters.priorityMin");
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
    ...(priorityMax === undefined ? {} : { priorityMax })
  };
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
