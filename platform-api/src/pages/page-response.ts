import {
  pageContentStatuses,
  pageIndexabilities,
  pageLifecycleStatuses,
  pageSourceTypes,
  pageTypes,
  type PageAliasSummary,
  type PageSourceSummary,
  type ProjectPageCollection,
  type ProjectPageSummary
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const PAGE_KEYS = [
  "id", "workspaceId", "projectId", "url", "normalizedUrl", "aliases",
  "sources", "pageType", "indexability", "httpStatus", "canonicalTarget",
  "robots", "title", "description", "h1", "language", "template",
  "contentStatus", "ownerId", "priority", "publishedAt", "crawledAt",
  "analyticsMetrics", "notes", "assignedKeywordCount", "assignedClusterCount", "lifecycleStatus",
  "version", "createdBy", "updatedBy", "archivedBy", "createdAt",
  "updatedAt", "archivedAt"
] as const;

export function scopedProjectPageCollection(
  value: unknown,
  workspaceId: string,
  projectId: string
): ProjectPageCollection {
  const collection = exactRecord(value, ["pages", "nextCursor"]);
  if (
    !Array.isArray(collection.pages) ||
    collection.pages.length > 100 ||
    (collection.nextCursor !== undefined &&
      typeof collection.nextCursor !== "string")
  ) {
    invalidResponse();
  }
  const pages = collection.pages.map((page) =>
    scopedProjectPage(page, workspaceId, projectId)
  );
  if (new Set(pages.map(({ id }) => id)).size !== pages.length) {
    invalidResponse();
  }
  return {
    pages,
    ...(typeof collection.nextCursor === "string"
      ? { nextCursor: collection.nextCursor }
      : {})
  };
}

export function scopedProjectPage(
  value: unknown,
  workspaceId: string,
  projectId: string,
  expectedPageId?: string
): ProjectPageSummary {
  const page = exactRecord(value, PAGE_KEYS);
  if (
    !uuid(page.id) ||
    page.workspaceId !== workspaceId ||
    page.projectId !== projectId ||
    (expectedPageId !== undefined && page.id !== expectedPageId) ||
    !nonEmptyString(page.url) ||
    !nonEmptyString(page.normalizedUrl) ||
    !Array.isArray(page.aliases) ||
    page.aliases.length > 100 ||
    !Array.isArray(page.sources) ||
    page.sources.length > pageSourceTypes.length ||
    typeof page.pageType !== "string" ||
    !pageTypes.some((value) => value === page.pageType) ||
    typeof page.indexability !== "string" ||
    !pageIndexabilities.some((value) => value === page.indexability) ||
    !optionalInteger(page.httpStatus, 100, 599) ||
    !optionalString(page.canonicalTarget) ||
    !optionalString(page.robots) ||
    !optionalString(page.title) ||
    !optionalString(page.description) ||
    !optionalString(page.h1) ||
    !optionalString(page.language) ||
    !optionalString(page.template) ||
    (page.contentStatus !== undefined &&
      (typeof page.contentStatus !== "string" ||
        !pageContentStatuses.some(
          (value) => value === page.contentStatus
        ))) ||
    (page.ownerId !== undefined && !uuid(page.ownerId)) ||
    !integer(page.priority, 0, 100) ||
    !optionalDate(page.publishedAt) ||
    !optionalDate(page.crawledAt) ||
    !numericRecord(page.analyticsMetrics) ||
    !optionalString(page.notes) ||
    !integer(page.assignedKeywordCount, 0, Number.MAX_SAFE_INTEGER) ||
    !integer(page.assignedClusterCount, 0, Number.MAX_SAFE_INTEGER) ||
    typeof page.lifecycleStatus !== "string" ||
    !pageLifecycleStatuses.some(
      (value) => value === page.lifecycleStatus
    ) ||
    !integer(page.version, 1, Number.MAX_SAFE_INTEGER) ||
    (page.createdBy !== undefined && !uuid(page.createdBy)) ||
    (page.updatedBy !== undefined && !uuid(page.updatedBy)) ||
    (page.archivedBy !== undefined && !uuid(page.archivedBy)) ||
    !date(page.createdAt) ||
    !date(page.updatedAt) ||
    !optionalDate(page.archivedAt)
  ) {
    invalidResponse();
  }
  const aliases = page.aliases.map(pageAlias);
  const sources = page.sources.map(pageSource);
  if (
    new Set(aliases.map(({ id }) => id)).size !== aliases.length ||
    new Set(sources.map(({ source }) => source)).size !== sources.length ||
    (page.lifecycleStatus === "ARCHIVED") !==
      (page.archivedAt !== undefined && page.archivedBy !== undefined)
  ) {
    invalidResponse();
  }
  return page as unknown as ProjectPageSummary;
}

function pageAlias(value: unknown): PageAliasSummary {
  const alias = exactRecord(value, [
    "id", "url", "normalizedUrl", "source", "firstSeenAt", "lastSeenAt"
  ]);
  if (
    !uuid(alias.id) ||
    !nonEmptyString(alias.url) ||
    !nonEmptyString(alias.normalizedUrl) ||
    typeof alias.source !== "string" ||
    !pageSourceTypes.some((source) => source === alias.source) ||
    !date(alias.firstSeenAt) ||
    !date(alias.lastSeenAt)
  ) {
    invalidResponse();
  }
  return alias as unknown as PageAliasSummary;
}

function pageSource(value: unknown): PageSourceSummary {
  const source = exactRecord(value, [
    "source", "firstSeenAt", "lastSeenAt"
  ]);
  if (
    typeof source.source !== "string" ||
    !pageSourceTypes.some((value) => value === source.source) ||
    !date(source.firstSeenAt) ||
    !date(source.lastSeenAt)
  ) {
    invalidResponse();
  }
  return source as unknown as PageSourceSummary;
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidResponse();
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (Object.keys(record).some((key) => !keys.includes(key))) {
    invalidResponse();
  }
  return record;
}

function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value
    )
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function integer(value: unknown, min: number, max: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= min &&
    Number(value) <= max
  );
}

function optionalInteger(value: unknown, min: number, max: number): boolean {
  return value === undefined || integer(value, min, max);
}

function date(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(new Date(value).getTime())
  );
}

function optionalDate(value: unknown): boolean {
  return value === undefined || date(value);
}

function numericRecord(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (item) => typeof item === "number" && Number.isFinite(item)
    )
  );
}

function invalidResponse(): never {
  throw new DomainError({
    statusCode: 503,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "SEO data service returned an invalid page response",
    retryable: true
  });
}
