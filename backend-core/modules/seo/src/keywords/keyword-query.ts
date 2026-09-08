import { BadRequestException } from "@nestjs/common";
import {
  semanticKeywordDefaultPageSize,
  semanticKeywordIntents,
  semanticKeywordMaxPageSize,
  semanticKeywordMultiSearchMaxTerms,
  semanticKeywordMultiSearchModes,
  semanticKeywordSorts,
  isSemanticRankDimensionSort,
  parseSemanticRankDimensionKey,
  type KeywordListQuery,
  type ProjectPositionHistoryQuery,
  type SemanticKeywordMultiSearchInput
} from "@seo-platform/contracts";

const CURSOR_PATTERN = /^[A-Za-z0-9_-]{8,5000}$/u;
const BODY_QUERY_FIELDS = [
  "limit", "cursor", "search", "tag", "intent", "groupId", "groupIds",
  "clusterId", "isFavorite", "isTracked", "priorityMin", "priorityMax", "sort"
  , "frequencyBaseMin", "frequencyBaseMax", "frequencyExactMin", "frequencyExactMax",
  "frequencyFixedMin", "frequencyFixedMax", "wordCountMin", "wordCountMax", "targetUrlState",
  "rankDimensionKey", "rankState", "rankPositionMin", "rankPositionMax", "rankCheckedFrom", "rankCheckedBefore",
  "rankSortDimensionKey"
] as const;

export function keywordMultiSearchInput(value: unknown): KeywordListQuery {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("body");
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => key !== "query" && key !== "search")) invalid("body");
  const parsedQuery = keywordListQuery(bodyQuery(input.query));
  if (typeof input.search !== "object" || input.search === null || Array.isArray(input.search)) invalid("search");
  const search = input.search as Readonly<Record<string, unknown>>;
  if (Object.keys(search).some((key) => key !== "terms" && key !== "mode")) invalid("search");
  if (!Array.isArray(search.terms) || search.terms.length < 1 || search.terms.length > semanticKeywordMultiSearchMaxTerms) invalid("search.terms");
  const terms = search.terms.map((candidate, index) => {
    if (typeof candidate !== "string") invalid(`search.terms.${index}`);
    const term = candidate.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (!term || term.length > 400) invalid(`search.terms.${index}`);
    return term;
  });
  if (new Set(terms.map((term) => term.toLocaleLowerCase("ru"))).size !== terms.length) invalid("search.terms");
  const mode = typeof search.mode === "string" && semanticKeywordMultiSearchModes.includes(search.mode as never)
    ? search.mode as SemanticKeywordMultiSearchInput["search"]["mode"]
    : invalid("search.mode");
  return { ...parsedQuery, multiSearch: { terms, mode } };
}

export function keywordBodyListInput(value: unknown): KeywordListQuery {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("body");
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => key !== "query")) invalid("body");
  return keywordListQuery(bodyQuery(input.query));
}

export function keywordTagOptionsQuery(
  value: unknown
): Readonly<{ search?: string }> {
  const query =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};
  const search = optionalSingleString(query.search, "search")
    ?.normalize("NFKC")
    .toLocaleLowerCase()
    .trim();
  if (search && search.length > 160) invalid("search");
  return search ? { search } : {};
}

export function projectPositionHistoryQuery(
  value: unknown
): ProjectPositionHistoryQuery {
  const query =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};
  if (Object.keys(query).some((key) =>
    key !== "includeUntracked" && key !== "rankDimensionKey"
  )) {
    invalid("query");
  }
  const rankDimensionKey = optionalSingleString(
    query.rankDimensionKey,
    "rankDimensionKey"
  );
  if (rankDimensionKey && !parseSemanticRankDimensionKey(rankDimensionKey)) {
    invalid("rankDimensionKey");
  }
  return {
    includeUntracked:
      optionalBoolean(query.includeUntracked, "includeUntracked") ?? false,
    ...(rankDimensionKey ? { rankDimensionKey } : {})
  };
}

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
  const tag = optionalSingleString(query.tag, "tag")
    ?.normalize("NFKC")
    .toLocaleLowerCase()
    .trim();
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
  const frequencyBaseMin = optionalBigintString(query.frequencyBaseMin, "frequencyBaseMin");
  const frequencyBaseMax = optionalBigintString(query.frequencyBaseMax, "frequencyBaseMax");
  const frequencyExactMin = optionalBigintString(query.frequencyExactMin, "frequencyExactMin");
  const frequencyExactMax = optionalBigintString(query.frequencyExactMax, "frequencyExactMax");
  const frequencyFixedMin = optionalBigintString(query.frequencyFixedMin, "frequencyFixedMin");
  const frequencyFixedMax = optionalBigintString(query.frequencyFixedMax, "frequencyFixedMax");
  const wordCountMin = optionalInteger(query.wordCountMin, "wordCountMin");
  const wordCountMax = optionalInteger(query.wordCountMax, "wordCountMax");
  const targetUrlState = optionalEnum(query.targetUrlState, "targetUrlState", ["SET", "EMPTY"] as const);
  const rankDimensionKey = optionalSingleString(query.rankDimensionKey, "rankDimensionKey");
  if (rankDimensionKey && !parseSemanticRankDimensionKey(rankDimensionKey)) invalid("rankDimensionKey");
  const rankState = optionalEnum(query.rankState, "rankState", ["CHECKED", "FOUND", "NOT_FOUND", "NOT_CHECKED"] as const);
  const rankPositionMin = optionalInteger(query.rankPositionMin, "rankPositionMin");
  const rankPositionMax = optionalInteger(query.rankPositionMax, "rankPositionMax");
  const rankCheckedFrom = optionalIsoInstant(query.rankCheckedFrom, "rankCheckedFrom");
  const rankCheckedBefore = optionalIsoInstant(query.rankCheckedBefore, "rankCheckedBefore");
  const sort =
    optionalEnum(query.sort, "sort", semanticKeywordSorts) ??
    "CREATED_DESC";
  const rankSortDimensionKey = optionalSingleString(
    query.rankSortDimensionKey,
    "rankSortDimensionKey"
  );
  if (
    rankSortDimensionKey &&
    !parseSemanticRankDimensionKey(rankSortDimensionKey)
  ) {
    invalid("rankSortDimensionKey");
  }
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
  if (tag && tag.length > 160) invalid("tag");
  if (
    priorityMin !== undefined &&
    (priorityMin < 0 || priorityMin > 100)
  ) {
    invalid("priorityMin");
  }
  validateRange(frequencyBaseMin, frequencyBaseMax, "frequencyBaseMin");
  validateRange(frequencyExactMin, frequencyExactMax, "frequencyExactMin");
  validateRange(frequencyFixedMin, frequencyFixedMax, "frequencyFixedMin");
  validateNumberRange(wordCountMin, wordCountMax, 1, 10_000, "wordCountMin");
  validateNumberRange(rankPositionMin, rankPositionMax, 1, 100, "rankPositionMin");
  if (rankCheckedFrom && rankCheckedBefore && rankCheckedFrom >= rankCheckedBefore) invalid("rankCheckedFrom");
  if (!rankDimensionKey && (rankState || rankPositionMin !== undefined || rankPositionMax !== undefined || rankCheckedFrom || rankCheckedBefore)) invalid("rankDimensionKey");
  if ((rankState === "NOT_CHECKED" && (rankPositionMin !== undefined || rankPositionMax !== undefined || rankCheckedFrom || rankCheckedBefore)) ||
    (rankState === "NOT_FOUND" && (rankPositionMin !== undefined || rankPositionMax !== undefined))) invalid("rankState");
  if (isSemanticRankDimensionSort(sort) !== Boolean(rankSortDimensionKey)) {
    invalid("rankSortDimensionKey");
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
    ...(tag ? { tag } : {}),
    ...(intent ? { intent } : {}),
    ...(groupId ? { groupId } : {}),
    ...(groupIds.length > 0 ? { groupIds } : {}),
    ...(clusterId ? { clusterId } : {}),
    ...(isFavorite === undefined ? {} : { isFavorite }),
    ...(isTracked === undefined ? {} : { isTracked }),
    ...(priorityMin === undefined ? {} : { priorityMin }),
    ...(priorityMax === undefined ? {} : { priorityMax }),
    ...(frequencyBaseMin ? { frequencyBaseMin } : {}), ...(frequencyBaseMax ? { frequencyBaseMax } : {}),
    ...(frequencyExactMin ? { frequencyExactMin } : {}), ...(frequencyExactMax ? { frequencyExactMax } : {}),
    ...(frequencyFixedMin ? { frequencyFixedMin } : {}), ...(frequencyFixedMax ? { frequencyFixedMax } : {}),
    ...(wordCountMin === undefined ? {} : { wordCountMin }), ...(wordCountMax === undefined ? {} : { wordCountMax }),
    ...(targetUrlState ? { targetUrlState } : {}), ...(rankDimensionKey ? { rankDimensionKey } : {}),
    ...(rankState ? { rankState } : {}), ...(rankPositionMin === undefined ? {} : { rankPositionMin }),
    ...(rankPositionMax === undefined ? {} : { rankPositionMax }), ...(rankCheckedFrom ? { rankCheckedFrom } : {}),
    ...(rankCheckedBefore ? { rankCheckedBefore } : {}),
    ...(rankSortDimensionKey ? { rankSortDimensionKey } : {}),
    sort
  };
}

function optionalUuidList(value: unknown, field: string): readonly string[] {
  const parsed = optionalSingleString(value, field);
  if (parsed === undefined) return [];
  const values = parsed.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (values.length < 2) invalid(field);
  const ids = values.map((entry) => optionalUuid(entry, field));
  if (ids.some((id) => id === undefined)) invalid(field);
  const canonical = ids as string[];
  if (new Set(canonical).size !== canonical.length) invalid(field);
  if (canonical.length > 2_000) invalid(field);
  return [...canonical].sort();
}

function bodyQuery(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("query");
  const query = value as Readonly<Record<string, unknown>>;
  if (Object.keys(query).some((key) => !BODY_QUERY_FIELDS.includes(key as never))) invalid("query");
  const result: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(query)) {
    if (candidate === undefined) continue;
    if (key === "groupIds") {
      if (!Array.isArray(candidate) || !candidate.every((item) => typeof item === "string")) invalid("query.groupIds");
      result[key] = candidate.join(",");
      continue;
    }
    if (typeof candidate !== "string" && typeof candidate !== "number" && typeof candidate !== "boolean") invalid(`query.${key}`);
    result[key] = String(candidate);
  }
  return result;
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

function optionalBigintString(value: unknown, field: string): string | undefined {
  const parsed = optionalSingleString(value, field);
  if (parsed === undefined) return undefined;
  if (!/^(?:0|[1-9]\d{0,18})$/u.test(parsed) || BigInt(parsed) > 9_223_372_036_854_775_807n) invalid(field);
  return parsed;
}

function optionalIsoInstant(value: unknown, field: string): string | undefined {
  const parsed = optionalSingleString(value, field);
  if (parsed === undefined) return undefined;
  if (parsed.length !== 24 || Number.isNaN(Date.parse(parsed)) || new Date(parsed).toISOString() !== parsed) invalid(field);
  return parsed;
}

function validateRange(min: string | undefined, max: string | undefined, field: string): void {
  if (min !== undefined && max !== undefined && BigInt(min) > BigInt(max)) invalid(field);
}

function validateNumberRange(min: number | undefined, max: number | undefined, lower: number, upper: number, field: string): void {
  if ((min !== undefined && (min < lower || min > upper)) || (max !== undefined && (max < lower || max > upper)) || (min !== undefined && max !== undefined && min > max)) invalid(field);
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
