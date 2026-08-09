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
  "openIssueCount", "latestCrawl",
  "version", "createdBy", "updatedBy", "archivedBy", "createdAt",
  "updatedAt", "archivedAt"
] as const;

export function scopedProjectPageCollection(
  value: unknown,
  workspaceId: string,
  projectId: string
): ProjectPageCollection {
  const collection = exactRecord(value, ["pages", "nextCursor", "structureUrls"]);
  if (
    !Array.isArray(collection.pages) ||
    collection.pages.length > 100 ||
    (collection.nextCursor !== undefined &&
      typeof collection.nextCursor !== "string") ||
    (collection.structureUrls !== undefined &&
      (!Array.isArray(collection.structureUrls) ||
        collection.structureUrls.length > 5_000 ||
        collection.structureUrls.some((item) => typeof item !== "string")))
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
    ...(Array.isArray(collection.structureUrls)
      ? { structureUrls: collection.structureUrls as readonly string[] }
      : {}),
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
    !optionalInteger(page.openIssueCount, 0, Number.MAX_SAFE_INTEGER) ||
    !optionalLatestCrawl(page.latestCrawl) ||
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

function optionalLatestCrawl(value: unknown): boolean {
  if (value === undefined) return true;
  let crawl: Readonly<Record<string, unknown>>;
  try {
    crawl = exactRecord(value, [
      "crawlId", "statusCode", "responseTimeMs", "sizeBytes", "contentType",
      "title", "description", "h1", "h1Count", "canonicalUrl", "robots",
      "language", "metaTags", "imageCount", "imagesMissingAlt",
      "structuredDataTypes", "wordCount", "redirectChain", "inSitemap",
      "depth", "indexability", "crawledAt"
    ]);
  } catch {
    return false;
  }
  return (
    uuid(crawl.crawlId) &&
    integer(crawl.statusCode, 100, 599) &&
    integer(crawl.responseTimeMs, 0, 3_600_000) &&
    integer(crawl.sizeBytes, 0, 10_000_000) &&
    nonEmptyString(crawl.contentType) &&
    optionalString(crawl.title) &&
    optionalString(crawl.description) &&
    optionalString(crawl.h1) &&
    integer(crawl.h1Count, 0, 10_000) &&
    optionalString(crawl.canonicalUrl) &&
    optionalString(crawl.robots) &&
    optionalString(crawl.language) &&
    metaTagArray(crawl.metaTags) &&
    integer(crawl.imageCount, 0, 100_000) &&
    integer(crawl.imagesMissingAlt, 0, Number(crawl.imageCount)) &&
    stringArray(crawl.structuredDataTypes, 100) &&
    integer(crawl.wordCount, 0, 10_000_000) &&
    stringArray(crawl.redirectChain, 10) &&
    typeof crawl.inSitemap === "boolean" &&
    integer(crawl.depth, 0, 10) &&
    typeof crawl.indexability === "string" &&
    pageIndexabilities.includes(
      crawl.indexability as (typeof pageIndexabilities)[number]
    ) &&
    date(crawl.crawledAt)
  );
}

function metaTagArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 200 &&
    value.every((candidate) => {
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        Array.isArray(candidate)
      ) return false;
      const tag = candidate as Readonly<Record<string, unknown>>;
      return (
        Object.keys(tag).every((key) =>
          ["name", "property", "httpEquiv", "content"].includes(key)
        ) &&
        nonEmptyString(tag.content) &&
        optionalString(tag.name) &&
        optionalString(tag.property) &&
        optionalString(tag.httpEquiv) &&
        [tag.name, tag.property, tag.httpEquiv].some(
          (item) => typeof item === "string" && item.length > 0
        )
      );
    })
  );
}

function stringArray(value: unknown, max: number): boolean {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((item) => typeof item === "string")
  );
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
