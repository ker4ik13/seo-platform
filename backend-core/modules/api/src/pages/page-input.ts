import { validationError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import {
  parseProjectPageListOptions,
  pageContentStatuses,
  pageIndexabilities,
  pageLifecycleStatuses,
  pageTypes,
  type CreateProjectPageInput,
  type PageContentStatus,
  type PageIndexability,
  type PageLifecycleStatus,
  type PageType,
  type ProjectPageInput,
  type ProjectPageListQuery,
  type UpdateProjectPageInput
} from "@seo-platform/contracts";

const PAGE_TYPES = new Set<string>(pageTypes);
const INDEXABILITIES = new Set<string>(pageIndexabilities);
const CONTENT_STATUSES = new Set<string>(pageContentStatuses);
const LIFECYCLE_STATUSES = new Set<string>(pageLifecycleStatuses);
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{8,1200}$/u;
const INPUT_KEYS = [
  "url",
  "aliases",
  "pageType",
  "indexability",
  "httpStatus",
  "canonicalTarget",
  "robots",
  "title",
  "description",
  "h1",
  "language",
  "template",
  "contentStatus",
  "ownerId",
  "priority",
  "publishedAt",
  "notes"
] as const;

export function createProjectPageInput(
  value: unknown
): CreateProjectPageInput {
  return pageInput(strictRecord(value, INPUT_KEYS));
}

export function updateProjectPageInput(
  value: unknown
): UpdateProjectPageInput {
  return pageInput(strictRecord(value, INPUT_KEYS));
}

export function projectPageQuery(value: unknown): ProjectPageListQuery {
  const query =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};
  const allowed = [
    "limit",
    "cursor",
    "search",
    "pathPrefix",
    "pageType",
    "indexability",
    "lifecycleStatus", "sort", "sortDirection", "dimensionKey", "date", "includeStructure"
  ];
  if (Object.keys(query).some((key) => !allowed.includes(key))) {
    invalid("query");
  }
  const limitValue = queryString(query.limit, "limit");
  const limit = limitValue === undefined ? 50 : Number(limitValue);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    invalid("limit");
  }
  const cursor = queryString(query.cursor, "cursor");
  if (cursor && !CURSOR_PATTERN.test(cursor)) invalid("cursor");
  const search = queryString(query.search, "search")?.normalize("NFKC");
  if (search && search.length > 300) invalid("search");
  const pathPrefix = queryString(query.pathPrefix, "pathPrefix")?.normalize(
    "NFKC"
  );
  if (
    pathPrefix &&
    (!pathPrefix.startsWith("/") ||
      pathPrefix.length > 2_048 ||
      pathPrefix.includes("?") ||
      pathPrefix.includes("#"))
  ) {
    invalid("pathPrefix");
  }
  const pageType = optionalEnum(query.pageType, "pageType", PAGE_TYPES) as
    | PageType
    | undefined;
  const indexability = optionalEnum(
    query.indexability,
    "indexability",
    INDEXABILITIES
  ) as PageIndexability | undefined;
  const lifecycleStatus = optionalEnum(
    query.lifecycleStatus,
    "lifecycleStatus",
    LIFECYCLE_STATUSES
  ) as PageLifecycleStatus | undefined;
  let options;
  try { options = parseProjectPageListOptions(query); } catch { invalid("query"); }
  return {
    ...options,
    limit,
    ...(cursor ? { cursor } : {}),
    ...(search ? { search } : {}),
    ...(pathPrefix ? { pathPrefix } : {}),
    ...(pageType ? { pageType } : {}),
    ...(indexability ? { indexability } : {}),
    ...(lifecycleStatus ? { lifecycleStatus } : {})
  };
}

function pageInput(
  input: Readonly<Record<string, unknown>>
): ProjectPageInput {
  const aliases = input.aliases;
  if (
    !Array.isArray(aliases) ||
    aliases.length > 100 ||
    aliases.some((value) => typeof value !== "string")
  ) {
    invalid("aliases");
  }
  const pageType = requiredEnum(input.pageType, "pageType", PAGE_TYPES) as PageType;
  const indexability = requiredEnum(
    input.indexability,
    "indexability",
    INDEXABILITIES
  ) as PageIndexability;
  const contentStatus = optionalEnum(
    input.contentStatus,
    "contentStatus",
    CONTENT_STATUSES
  ) as PageContentStatus | undefined;
  return {
    url: normalizedUrl(input.url, "url"),
    aliases: aliases.map((value, index) =>
      normalizedUrl(value, `aliases.${index}`)
    ),
    pageType,
    indexability,
    ...optionalInteger(input.httpStatus, "httpStatus", 100, 599),
    ...optionalUrl(input.canonicalTarget, "canonicalTarget"),
    ...optionalText(input.robots, "robots", 255),
    ...optionalText(input.title, "title", 1_000),
    ...optionalText(input.description, "description", 4_000),
    ...optionalText(input.h1, "h1", 1_000),
    ...optionalLanguage(input.language),
    ...optionalText(input.template, "template", 160),
    ...(contentStatus ? { contentStatus } : {}),
    ...optionalOwner(input.ownerId),
    priority: integer(input.priority, "priority", 0, 100),
    ...optionalDate(input.publishedAt, "publishedAt"),
    ...optionalText(input.notes, "notes", 20_000)
  };
}

function strictRecord(
  value: unknown,
  allowed: readonly string[]
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    invalid("body");
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    invalid("body");
  }
  return record;
}

function normalizedUrl(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4_096) {
    invalid(field);
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    invalid(field);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    invalid(field);
  }
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  return url.toString();
}

function requiredEnum(
  value: unknown,
  field: string,
  allowed: ReadonlySet<string>
): string {
  if (typeof value !== "string" || !allowed.has(value)) invalid(field);
  return value;
}

function optionalEnum(
  value: unknown,
  field: string,
  allowed: ReadonlySet<string>
): string | undefined {
  const source = queryString(value, field);
  if (source === undefined) return undefined;
  if (!allowed.has(source)) invalid(field);
  return source;
}

function queryString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
}

function optionalText(
  value: unknown,
  field: string,
  max: number
): Readonly<Record<string, string>> {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string") invalid(field);
  const result = value.normalize("NFKC").trim();
  if (!result || result.length > max) invalid(field);
  return { [field]: result };
}

function optionalUrl(
  value: unknown,
  field: string
): Readonly<Record<string, string>> {
  if (value === undefined || value === null || value === "") return {};
  return { [field]: normalizedUrl(value, field) };
}

function optionalOwner(
  value: unknown
): Readonly<{ ownerId?: string }> {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string") invalid("ownerId");
  return { ownerId: assertUuid(value, "ownerId") };
}

function optionalLanguage(
  value: unknown
): Readonly<{ language?: string }> {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string") invalid("language");
  let language: string;
  try {
    language = Intl.getCanonicalLocales(value.trim())[0] ?? "";
  } catch {
    invalid("language");
  }
  if (!language || language.length > 16) invalid("language");
  return { language };
}

function optionalInteger(
  value: unknown,
  field: string,
  min: number,
  max: number
): Readonly<Record<string, number>> {
  if (value === undefined || value === null || value === "") return {};
  return { [field]: integer(value, field, min, max) };
}

function integer(
  value: unknown,
  field: string,
  min: number,
  max: number
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < min ||
    Number(value) > max
  ) {
    invalid(field);
  }
  return Number(value);
}

function optionalDate(
  value: unknown,
  field: string
): Readonly<Record<string, string>> {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string") invalid(field);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    invalid(field);
  }
  return { [field]: value };
}

function invalid(field: string): never {
  throw validationError(
    field,
    "INVALID_PAGE_FIELD",
    `Invalid page field: ${field}`
  );
}
