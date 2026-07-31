import { BadRequestException } from "@nestjs/common";
import {
  technicalCrawlStatuses,
  type CrawlIssueSeverity,
  type CrawlPageIndexability,
  type InternalFinalizeCrawlSnapshotInput,
  type InternalPersistCrawlPageInput
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";
import { normalizePageUrl } from "../pages/page-url.js";

const HASH = /^[0-9a-f]{64}$/u;
const INDEXABILITIES = new Set([
  "INDEXABLE",
  "NOINDEX",
  "CANONICALIZED",
  "REDIRECTED",
  "ERROR",
  "UNKNOWN"
]);
const SEVERITIES = new Set(["INFO", "WARNING", "ERROR", "CRITICAL"]);

export function internalPersistCrawlPageInput(
  value: unknown
): InternalPersistCrawlPageInput {
  const input = object(value);
  const requiredKeys = [
    "workspaceId", "projectId", "crawlId", "sequence", "requestedUrl",
    "finalUrl", "depth", "statusCode", "responseTimeMs", "sizeBytes",
    "contentType", "h1Count", "headings", "hreflang", "internalLinks",
    "externalLinks", "imageCount", "imagesMissingAlt",
    "structuredDataTypes", "wordCount", "contentHash", "indexability",
    "issues", "crawledAt"
  ];
  const optionalKeys = [
    "title", "description", "h1", "canonicalUrl", "robots", "language"
  ];
  if (
    Object.keys(input).some(
      (key) => !requiredKeys.includes(key) && !optionalKeys.includes(key)
    ) ||
    requiredKeys.some((key) => !(key in input))
  ) invalid("body");
  const imageCount = integer(input.imageCount, "imageCount", 0, 100_000);
  const imagesMissingAlt = integer(
    input.imagesMissingAlt,
    "imagesMissingAlt",
    0,
    imageCount
  );
  const indexability = enumValue(
    input.indexability,
    "indexability",
    INDEXABILITIES
  ) as CrawlPageIndexability;
  return {
    workspaceId: internalUuid(string(input.workspaceId, "workspaceId", 64), "workspaceId"),
    projectId: internalUuid(string(input.projectId, "projectId", 64), "projectId"),
    crawlId: internalUuid(string(input.crawlId, "crawlId", 64), "crawlId"),
    sequence: integer(input.sequence, "sequence", 1, 1_000),
    requestedUrl: normalizePageUrl(string(input.requestedUrl, "requestedUrl", 4_096)).normalized,
    finalUrl: normalizePageUrl(string(input.finalUrl, "finalUrl", 4_096)).normalized,
    depth: integer(input.depth, "depth", 0, 10),
    statusCode: integer(input.statusCode, "statusCode", 100, 599),
    responseTimeMs: integer(input.responseTimeMs, "responseTimeMs", 0, 3_600_000),
    sizeBytes: integer(input.sizeBytes, "sizeBytes", 0, 10_000_000),
    contentType: string(input.contentType, "contentType", 160),
    ...optional(input, "title", 1_000),
    ...optional(input, "description", 4_000),
    ...optional(input, "h1", 1_000),
    h1Count: integer(input.h1Count, "h1Count", 0, 10_000),
    ...optionalUrl(input, "canonicalUrl"),
    ...optional(input, "robots", 255),
    ...optional(input, "language", 16),
    headings: objectArray(input.headings, "headings", 500, (item, index) => ({
      level: integer(item.level, `headings.${index}.level`, 1, 6),
      text: string(item.text, `headings.${index}.text`, 1_000)
    }), ["level", "text"]),
    hreflang: objectArray(input.hreflang, "hreflang", 100, (item, index) => ({
      language: string(item.language, `hreflang.${index}.language`, 35),
      url: normalizePageUrl(string(item.url, `hreflang.${index}.url`, 4_096)).normalized
    }), ["language", "url"]),
    internalLinks: urlArray(input.internalLinks, "internalLinks", 5_000),
    externalLinks: urlArray(input.externalLinks, "externalLinks", 5_000),
    imageCount,
    imagesMissingAlt,
    structuredDataTypes: stringArray(
      input.structuredDataTypes,
      "structuredDataTypes",
      100,
      160
    ),
    wordCount: integer(input.wordCount, "wordCount", 0, 10_000_000),
    contentHash: pattern(input.contentHash, "contentHash", HASH),
    indexability,
    issues: objectArray(input.issues, "issues", 100, (item, index) => ({
      code: pattern(item.code, `issues.${index}.code`, /^[A-Z][A-Z0-9_]{1,63}$/u),
      severity: enumValue(item.severity, `issues.${index}.severity`, SEVERITIES) as CrawlIssueSeverity,
      title: string(item.title, `issues.${index}.title`, 255),
      details: scalarRecord(item.details, `issues.${index}.details`)
    }), ["code", "severity", "title", "details"]),
    crawledAt: date(input.crawledAt, "crawledAt")
  };
}

export function internalFinalizeCrawlSnapshotInput(
  value: unknown
): InternalFinalizeCrawlSnapshotInput {
  const input = object(value);
  const keys = [
    "workspaceId",
    "projectId",
    "crawlId",
    "status",
    "processedUrls"
  ];
  if (Object.keys(input).some((key) => !keys.includes(key)) ||
      keys.some((key) => !(key in input))) invalid("body");
  if (
    !["COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED"].includes(
      String(input.status)
    ) ||
    !technicalCrawlStatuses.includes(
      input.status as (typeof technicalCrawlStatuses)[number]
    )
  ) invalid("status");
  return {
    workspaceId: internalUuid(string(input.workspaceId, "workspaceId", 64), "workspaceId"),
    projectId: internalUuid(string(input.projectId, "projectId", 64), "projectId"),
    crawlId: internalUuid(string(input.crawlId, "crawlId", 64), "crawlId"),
    status: input.status as InternalFinalizeCrawlSnapshotInput["status"],
    processedUrls: integer(input.processedUrls, "processedUrls", 0, 1_000)
  };
}

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  return value as Readonly<Record<string, unknown>>;
}

function objectArray<T>(
  value: unknown,
  field: string,
  max: number,
  map: (item: Readonly<Record<string, unknown>>, index: number) => T,
  keys: readonly string[]
): readonly T[] {
  if (!Array.isArray(value) || value.length > max) invalid(field);
  return value.map((candidate, index) => {
    const item = object(candidate);
    if (
      Object.keys(item).some((key) => !keys.includes(key)) ||
      keys.some((key) => !(key in item))
    ) invalid(`${field}.${index}`);
    return map(item, index);
  });
}

function urlArray(value: unknown, field: string, max: number): readonly string[] {
  return stringArray(value, field, max, 4_096).map((url) =>
    normalizePageUrl(url, field).normalized
  );
}

function stringArray(
  value: unknown,
  field: string,
  max: number,
  itemMax: number
): readonly string[] {
  if (!Array.isArray(value) || value.length > max) invalid(field);
  return value.map((item, index) =>
    string(item, `${field}.${index}`, itemMax)
  );
}

function scalarRecord(
  value: unknown,
  field: string
): Readonly<Record<string, string | number | boolean>> {
  const record = object(value);
  if (
    Object.keys(record).length > 30 ||
    Object.values(record).some(
      (item) =>
        !["string", "number", "boolean"].includes(typeof item) ||
        (typeof item === "string" && item.length > 1_000) ||
        (typeof item === "number" && !Number.isFinite(item))
    )
  ) invalid(field);
  return record as Readonly<Record<string, string | number | boolean>>;
}

function optional(
  input: Readonly<Record<string, unknown>>,
  field: string,
  max: number
): Readonly<Record<string, string>> {
  if (input[field] === undefined) return {};
  return { [field]: string(input[field], field, max) };
}

function optionalUrl(
  input: Readonly<Record<string, unknown>>,
  field: string
): Readonly<Record<string, string>> {
  if (input[field] === undefined) return {};
  return {
    [field]: normalizePageUrl(string(input[field], field, 4_096)).normalized
  };
}

function string(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") invalid(field);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > max) invalid(field);
  return normalized;
}

function integer(
  value: unknown,
  field: string,
  min: number,
  max: number
): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    invalid(field);
  }
  return Number(value);
}

function pattern(value: unknown, field: string, expression: RegExp): string {
  const parsed = string(value, field, 255);
  if (!expression.test(parsed)) invalid(field);
  return parsed;
}

function enumValue(value: unknown, field: string, values: Set<string>): string {
  if (typeof value !== "string" || !values.has(value)) invalid(field);
  return value;
}

function date(value: unknown, field: string): string {
  const parsed = string(value, field, 64);
  const timestamp = Date.parse(parsed);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== parsed) {
    invalid(field);
  }
  return parsed;
}

function invalid(field: string): never {
  throw new BadRequestException(`Invalid crawl snapshot field: ${field}`);
}
