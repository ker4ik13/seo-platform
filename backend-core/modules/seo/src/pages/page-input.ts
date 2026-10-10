import { BadRequestException } from "@nestjs/common";
import {
  parseProjectPageListOptions,
  pageContentStatuses,
  pageIndexabilities,
  pageLifecycleStatuses,
  pageTypes,
  type InternalChangeProjectPageStatusInput,
  type InternalCreateProjectPageInput,
  type InternalUpdateProjectPageInput,
  type PageContentStatus,
  type PageIndexability,
  type PageLifecycleStatus,
  type PageType,
  type ProjectPageInput,
  type ProjectPageListQuery
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";
import { normalizePageUrl } from "./page-url.js";

const PAGE_TYPES = new Set<string>(pageTypes);
const INDEXABILITIES = new Set<string>(pageIndexabilities);
const CONTENT_STATUSES = new Set<string>(pageContentStatuses);
const LIFECYCLE_STATUSES = new Set<string>(pageLifecycleStatuses);
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{8,1200}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;
const PAGE_INPUT_KEYS = [
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

export function internalCreateProjectPageInput(
  value: unknown
): InternalCreateProjectPageInput {
  const input = strictRecord(value, [
    ...PAGE_INPUT_KEYS,
    "workspaceId",
    "projectId",
    "actorId",
    "idempotencyKey"
  ]);
  return {
    ...scope(input),
    ...pageInput(input),
    idempotencyKey: idempotencyKey(input.idempotencyKey)
  };
}

export function internalUpdateProjectPageInput(
  value: unknown
): InternalUpdateProjectPageInput {
  const input = strictRecord(value, [
    ...PAGE_INPUT_KEYS,
    "workspaceId",
    "projectId",
    "actorId",
    "version"
  ]);
  return {
    ...scope(input),
    ...pageInput(input),
    version: positiveInteger(input.version, "version")
  };
}

export function internalChangeProjectPageStatusInput(
  value: unknown
): InternalChangeProjectPageStatusInput {
  const input = strictRecord(value, [
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

export function projectPageListQuery(
  value: unknown
): ProjectPageListQuery {
  const query =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};
  if (
    Object.keys(query).some(
      (key) =>
        ![
          "limit",
          "cursor",
          "search",
          "pathPrefix",
          "pageType",
          "indexability",
          "lifecycleStatus", "sort", "sortDirection", "dimensionKey", "date", "includeStructure"
        ].includes(key)
    )
  ) {
    invalid("query");
  }
  const limitValue = optionalQueryString(query.limit, "limit");
  const limit = limitValue === undefined ? 50 : Number(limitValue);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    invalid("limit");
  }
  const cursor = optionalQueryString(query.cursor, "cursor");
  if (cursor && !CURSOR_PATTERN.test(cursor)) invalid("cursor");
  const search = optionalQueryString(query.search, "search")?.normalize(
    "NFKC"
  );
  if (search && search.length > 300) invalid("search");
  const pathPrefix = optionalQueryString(
    query.pathPrefix,
    "pathPrefix"
  )?.normalize("NFKC");
  if (
    pathPrefix &&
    (!pathPrefix.startsWith("/") ||
      pathPrefix.length > 2_048 ||
      pathPrefix.includes("?") ||
      pathPrefix.includes("#"))
  ) {
    invalid("pathPrefix");
  }
  const pageType = optionalEnum(
    query.pageType,
    "pageType",
    PAGE_TYPES
  ) as PageType | undefined;
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
  const url = normalizePageUrl(requiredString(input.url, "url")).original;
  const aliases = stringArray(input.aliases, "aliases", 100).map(
    (alias, index) => normalizePageUrl(alias, `aliases.${index}`).original
  );
  const pageType = requiredEnum(
    input.pageType,
    "pageType",
    PAGE_TYPES
  ) as PageType;
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
    url,
    aliases,
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
    ...optionalUuid(input.ownerId, "ownerId"),
    priority: integer(input.priority, "priority", 0, 100),
    ...optionalDate(input.publishedAt, "publishedAt"),
    ...optionalText(input.notes, "notes", 20_000)
  };
}

function scope(input: Readonly<Record<string, unknown>>) {
  return {
    workspaceId: internalUuid(
      requiredString(input.workspaceId, "workspaceId"),
      "workspaceId"
    ),
    projectId: internalUuid(
      requiredString(input.projectId, "projectId"),
      "projectId"
    ),
    actorId: internalUuid(
      requiredString(input.actorId, "actorId"),
      "actorId"
    )
  };
}

function strictRecord(
  value: unknown,
  allowed: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    invalid("body");
  }
  return input;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(field);
  return value.trim();
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
  const source = optionalQueryString(value, field);
  if (source === undefined) return undefined;
  if (!allowed.has(source)) invalid(field);
  return source;
}

function optionalQueryString(
  value: unknown,
  field: string
): string | undefined {
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
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > max) invalid(field);
  return { [field]: normalized };
}

function optionalUrl(
  value: unknown,
  field: string
): Readonly<Record<string, string>> {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string") invalid(field);
  return { [field]: normalizePageUrl(value, field).normalized };
}

function optionalUuid(
  value: unknown,
  field: string
): Readonly<Record<string, string>> {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string") invalid(field);
  return { [field]: internalUuid(value, field) };
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

function positiveInteger(value: unknown, field: string): number {
  return integer(value, field, 1, Number.MAX_SAFE_INTEGER);
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

function stringArray(
  value: unknown,
  field: string,
  max: number
): readonly string[] {
  if (!Array.isArray(value) || value.length > max) invalid(field);
  return value.map((item, index) =>
    requiredString(item, `${field}.${index}`)
  );
}

function idempotencyKey(value: unknown): string {
  const key = requiredString(value, "idempotencyKey");
  if (!IDEMPOTENCY_PATTERN.test(key)) invalid("idempotencyKey");
  return key;
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid page field: ${field}`);
}
