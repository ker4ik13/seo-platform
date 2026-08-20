import {
  semanticKeywordDefaultPageSize,
  semanticKeywordIntents,
  semanticKeywordMaxPageSize,
  semanticKeywordMultiSearchMaxTerms,
  semanticKeywordMultiSearchModes,
  semanticKeywordSorts,
  type KeywordListQuery,
  type SemanticKeywordMultiSearchInput
} from "@seo-platform/contracts";
import { assertUuid } from "../common/identifier.js";
import { validationError } from "../common/domain-error.js";

const CURSOR_PATTERN = /^[A-Za-z0-9_-]{8,5000}$/u;
const BODY_QUERY_FIELDS = [
  "limit", "cursor", "search", "tag", "intent", "groupId", "groupIds",
  "clusterId", "isFavorite", "isTracked", "priorityMin", "priorityMax", "sort"
] as const;

export function keywordMultiSearchInput(
  value: unknown
): KeywordListQuery {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body", "Must be an object");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => key !== "query" && key !== "search")) {
    invalid("body", "Contains unsupported fields");
  }
  const parsedQuery = keywordListQuery(bodyQuery(input.query));
  if (typeof input.search !== "object" || input.search === null || Array.isArray(input.search)) {
    invalid("search", "Must be an object");
  }
  const search = input.search as Readonly<Record<string, unknown>>;
  if (Object.keys(search).some((key) => key !== "terms" && key !== "mode")) {
    invalid("search", "Contains unsupported fields");
  }
  if (
    !Array.isArray(search.terms) ||
    search.terms.length < 1 ||
    search.terms.length > semanticKeywordMultiSearchMaxTerms
  ) {
    invalid("search.terms", `Must contain 1–${semanticKeywordMultiSearchMaxTerms} queries`);
  }
  const terms = search.terms.map((candidate, index) => {
    if (typeof candidate !== "string") {
      invalid(`search.terms.${index}`, "Must be a string");
    }
    const term = candidate.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (!term || term.length > 400) {
      invalid(`search.terms.${index}`, "Must contain 1–400 characters");
    }
    return term;
  });
  const normalizedKeys = terms.map((term) => term.toLocaleLowerCase("ru"));
  if (new Set(normalizedKeys).size !== terms.length) {
    invalid("search.terms", "Must contain unique queries");
  }
  const mode = typeof search.mode === "string" &&
    semanticKeywordMultiSearchModes.includes(search.mode as never)
    ? search.mode as SemanticKeywordMultiSearchInput["search"]["mode"]
    : invalid("search.mode", `Must be one of: ${semanticKeywordMultiSearchModes.join(", ")}`);
  return { ...parsedQuery, multiSearch: { terms, mode } };
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
  if (search && search.length > 160) {
    invalid("search", "Must contain at most 160 characters");
  }
  return search ? { search } : {};
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
  const groupIdValue = optionalSingleString(query.groupId, "groupId");
  const groupId = groupIdValue
    ? assertUuid(groupIdValue, "groupId")
    : undefined;
  const groupIds = optionalUuidList(query.groupIds, "groupIds");
  const clusterIdValue = optionalSingleString(query.clusterId, "clusterId");
  const clusterId = clusterIdValue
    ? assertUuid(clusterIdValue, "clusterId")
    : undefined;
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
    invalid(
      "limit",
      `Must be an integer between 1 and ${semanticKeywordMaxPageSize}`
    );
  }
  if (groupId && groupIds.length > 0) {
    invalid("groupIds", "Must not be combined with groupId");
  }
  if (cursor && !CURSOR_PATTERN.test(cursor)) {
    invalid("cursor", "Must be a valid pagination cursor");
  }
  if (search && search.length > 200) {
    invalid("search", "Must contain at most 200 characters");
  }
  if (tag && tag.length > 160) {
    invalid("tag", "Must contain at most 160 characters");
  }
  if (
    priorityMin !== undefined &&
    (priorityMin < 0 || priorityMin > 100)
  ) {
    invalid("priorityMin", "Must be an integer between 0 and 100");
  }
  if (
    priorityMax !== undefined &&
    (priorityMax < 0 || priorityMax > 100)
  ) {
    invalid("priorityMax", "Must be an integer between 0 and 100");
  }
  if (
    priorityMin !== undefined &&
    priorityMax !== undefined &&
    priorityMin > priorityMax
  ) {
    invalid("priorityMin", "Must not be greater than priorityMax");
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
    sort
  };
}

function optionalUuidList(value: unknown, field: string): readonly string[] {
  const parsed = optionalSingleString(value, field);
  if (parsed === undefined) return [];
  const values = parsed.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (values.length < 2) {
    invalid(field, "Must contain at least 2 comma-separated UUIDs");
  }
  const ids = values.map((entry) => assertUuid(entry, field));
  if (new Set(ids).size !== ids.length) {
    invalid(field, "Must contain unique UUIDs");
  }
  return [...ids].sort();
}

function bodyQuery(value: unknown): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("query", "Must be an object");
  }
  const query = value as Readonly<Record<string, unknown>>;
  if (Object.keys(query).some((key) => !BODY_QUERY_FIELDS.includes(key as never))) {
    invalid("query", "Contains unsupported fields");
  }
  const result: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(query)) {
    if (candidate === undefined) continue;
    if (key === "groupIds") {
      if (!Array.isArray(candidate) || !candidate.every((item) => typeof item === "string")) {
        invalid("query.groupIds", "Must be an array of identifiers");
      }
      result[key] = candidate.join(",");
      continue;
    }
    if (typeof candidate !== "string" && typeof candidate !== "number" && typeof candidate !== "boolean") {
      invalid(`query.${key}`, "Has an invalid value");
    }
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
  if (!values.includes(parsed as T)) {
    invalid(field, `Must be one of: ${values.join(", ")}`);
  }
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
  return invalid(field, "Must be true or false");
}

function optionalInteger(
  value: unknown,
  field: string
): number | undefined {
  const parsed = optionalSingleString(value, field);
  if (parsed === undefined) return undefined;
  const integer = Number(parsed);
  if (!Number.isSafeInteger(integer)) {
    invalid(field, "Must be an integer");
  }
  return integer;
}

function optionalSingleString(
  value: unknown,
  field: string
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) {
    invalid(field, "Must be a single non-empty string");
  }
  return value.trim();
}

function invalid(field: string, message: string): never {
  throw validationError(field, "INVALID_QUERY_PARAMETER", message);
}
