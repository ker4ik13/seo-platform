import { BadRequestException } from "@nestjs/common";
import {
  semanticKeywordDefaultPageSize,
  semanticKeywordIntents,
  semanticKeywordMaxPageSize,
  semanticKeywordSorts,
  type KeywordListQuery
} from "@seo-platform/contracts";

const CURSOR_PATTERN = /^[A-Za-z0-9_-]{8,5000}$/u;

export function keywordListQuery(value: unknown): KeywordListQuery {
  const query =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};
  const limit = optionalSingleString(query.limit, "limit");
  const cursor = optionalSingleString(query.cursor, "cursor");
  const search = optionalSingleString(query.search, "search")?.normalize(
    "NFKC"
  );
  const intent = optionalEnum(
    query.intent,
    "intent",
    semanticKeywordIntents
  );
  const groupId = optionalUuid(query.groupId, "groupId");
  const groupIds = optionalUuidList(query.groupIds, "groupIds");
  const clusterId = optionalUuid(query.clusterId, "clusterId");
  const isFavorite = optionalBoolean(query.isFavorite, "isFavorite");
  const isTracked = optionalBoolean(query.isTracked, "isTracked");
  const priorityMin = optionalInteger(query.priorityMin, "priorityMin");
  const priorityMax = optionalInteger(query.priorityMax, "priorityMax");
  const sort =
    optionalEnum(query.sort, "sort", semanticKeywordSorts) ??
    "CREATED_DESC";
  const parsedLimit =
    limit === undefined ? semanticKeywordDefaultPageSize : Number(limit);
  if (
    !Number.isSafeInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > semanticKeywordMaxPageSize
  ) {
    invalid("limit");
  }
  if (cursor && !CURSOR_PATTERN.test(cursor)) invalid("cursor");
  if (search && search.length > 200) invalid("search");
  if (
    priorityMin !== undefined &&
    (priorityMin < 0 || priorityMin > 100)
  ) {
    invalid("priorityMin");
  }
  if (groupId && groupIds.length > 0) invalid("groupIds");
  if (
    priorityMax !== undefined &&
    (priorityMax < 0 || priorityMax > 100)
  ) {
    invalid("priorityMax");
  }
  if (
    priorityMin !== undefined &&
    priorityMax !== undefined &&
    priorityMin > priorityMax
  ) {
    invalid("priorityMin");
  }
  return {
    limit: parsedLimit,
    ...(cursor ? { cursor } : {}),
    ...(search ? { search } : {}),
    ...(intent ? { intent } : {}),
    ...(groupId ? { groupId } : {}),
    ...(groupIds.length > 0 ? { groupIds } : {}),
    ...(clusterId ? { clusterId } : {}),
    ...(isFavorite === undefined ? {} : { isFavorite }),
    ...(isTracked === undefined ? {} : { isTracked }),
    ...(priorityMin === undefined ? {} : { priorityMin }),
    ...(priorityMax === undefined ? {} : { priorityMax }),
    sort
  };
}

function optionalUuidList(value: unknown, field: string): readonly string[] {
  const parsed = optionalSingleString(value, field);
  if (parsed === undefined) return [];
  const values = parsed.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (values.length < 2 || values.length > 50) invalid(field);
  const ids = values.map((entry) => optionalUuid(entry, field));
  if (ids.some((id) => id === undefined)) invalid(field);
  const canonical = ids as string[];
  if (new Set(canonical).size !== canonical.length) invalid(field);
  return [...canonical].sort();
}

function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  values: readonly T[]
): T | undefined {
  const parsed = optionalSingleString(value, field);
  if (parsed === undefined) return undefined;
  if (!values.includes(parsed as T)) invalid(field);
  return parsed as T;
}

function optionalBoolean(
  value: unknown,
  field: string
): boolean | undefined {
  const parsed = optionalSingleString(value, field);
  if (parsed === undefined) return undefined;
  if (parsed === "true") return true;
  if (parsed === "false") return false;
  return invalid(field);
}

function optionalInteger(
  value: unknown,
  field: string
): number | undefined {
  const parsed = optionalSingleString(value, field);
  if (parsed === undefined) return undefined;
  const result = Number(parsed);
  if (!Number.isSafeInteger(result)) invalid(field);
  return result;
}

function optionalUuid(
  value: unknown,
  field: string
): string | undefined {
  const parsed = optionalSingleString(value, field);
  if (parsed === undefined) return undefined;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      parsed
    )
  ) {
    invalid(field);
  }
  return parsed;
}

function optionalSingleString(
  value: unknown,
  field: string
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid query parameter: ${field}`);
}
