import type {
  CrawlIssueSeverity,
  CrawlPageChangeField,
  InternalPersistCrawlPageInput
} from "@seo-platform/contracts";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";

export const crawlChangeSnapshotSelect = {
  id: true,
  statusCode: true,
  redirectChain: true,
  inSitemap: true,
  responseTimeMs: true,
  sizeBytes: true,
  title: true,
  description: true,
  h1: true,
  h1Count: true,
  canonicalUrl: true,
  robots: true,
  language: true,
  headings: true,
  hreflang: true,
  internalLinks: true,
  externalLinks: true,
  imageCount: true,
  imagesMissingAlt: true,
  structuredDataTypes: true,
  wordCount: true,
  contentHash: true,
  indexability: true,
  crawledAt: true
} as const;

export interface CrawlChangeSnapshot {
  readonly id: string;
  readonly statusCode: number;
  readonly redirectChain: unknown;
  readonly inSitemap: boolean;
  readonly responseTimeMs: number;
  readonly sizeBytes: number;
  readonly title: string | null;
  readonly description: string | null;
  readonly h1: string | null;
  readonly h1Count: number;
  readonly canonicalUrl: string | null;
  readonly robots: string | null;
  readonly language: string | null;
  readonly headings: unknown;
  readonly hreflang: unknown;
  readonly internalLinks: unknown;
  readonly externalLinks: unknown;
  readonly imageCount: number;
  readonly imagesMissingAlt: number;
  readonly structuredDataTypes: unknown;
  readonly wordCount: number;
  readonly contentHash: string;
  readonly indexability: string;
  readonly crawledAt: Date;
}

export interface DetectedCrawlPageChange {
  readonly severity: CrawlIssueSeverity;
  readonly changedFields: readonly CrawlPageChangeField[];
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly diffHash: string;
  readonly diff: Readonly<{
    schemaVersion: "crawl-page-change.v1";
    fields: readonly Readonly<Record<string, unknown>>[];
  }>;
}

interface ComparableSnapshot {
  readonly statusCode: number;
  readonly redirectChain: readonly unknown[];
  readonly inSitemap: boolean;
  readonly responseTimeMs: number;
  readonly sizeBytes: number;
  readonly title: string | null;
  readonly description: string | null;
  readonly h1: string | null;
  readonly h1Count: number;
  readonly canonicalUrl: string | null;
  readonly robots: string | null;
  readonly language: string | null;
  readonly headings: readonly unknown[];
  readonly hreflang: readonly unknown[];
  readonly internalLinks: readonly string[];
  readonly externalLinks: readonly string[];
  readonly imageCount: number;
  readonly imagesMissingAlt: number;
  readonly structuredDataTypes: readonly string[];
  readonly wordCount: number;
  readonly contentHash: string;
  readonly indexability: string;
}

const FIELD_SEVERITY: Readonly<Record<CrawlPageChangeField, CrawlIssueSeverity>> = {
  statusCode: "ERROR",
  redirectChain: "ERROR",
  inSitemap: "WARNING",
  title: "WARNING",
  description: "WARNING",
  h1: "WARNING",
  h1Count: "WARNING",
  headings: "WARNING",
  canonicalUrl: "ERROR",
  robots: "ERROR",
  language: "INFO",
  hreflang: "WARNING",
  internalLinks: "WARNING",
  externalLinks: "WARNING",
  imageCount: "WARNING",
  imagesMissingAlt: "WARNING",
  structuredDataTypes: "WARNING",
  wordCount: "INFO",
  contentHash: "INFO",
  indexability: "ERROR",
  responseTimeMs: "INFO",
  sizeBytes: "INFO"
};

const SEVERITY_WEIGHT: Readonly<Record<CrawlIssueSeverity, number>> = {
  INFO: 0,
  WARNING: 1,
  ERROR: 2,
  CRITICAL: 3
};

const COMPLEX_FIELDS = new Set<CrawlPageChangeField>([
  "redirectChain",
  "headings",
  "hreflang",
  "internalLinks",
  "externalLinks",
  "structuredDataTypes"
]);

export function detectCrawlPageChange(
  previous: CrawlChangeSnapshot,
  current: InternalPersistCrawlPageInput
): DetectedCrawlPageChange | undefined {
  const before = comparablePrevious(previous);
  const after = comparableCurrent(current);
  const changedFields = (
    Object.keys(FIELD_SEVERITY) as CrawlPageChangeField[]
  ).filter((field) => meaningfulChange(field, before[field], after[field]));
  if (changedFields.length === 0) return undefined;

  const fields = changedFields.map((field) =>
    normalizedFieldDiff(field, before[field], after[field])
  );
  const diff = {
    schemaVersion: "crawl-page-change.v1" as const,
    fields
  };
  const baseSeverity = changedFields.reduce<CrawlIssueSeverity>(
    (result, field) =>
      SEVERITY_WEIGHT[FIELD_SEVERITY[field]] > SEVERITY_WEIGHT[result]
        ? FIELD_SEVERITY[field]
        : result,
    "INFO"
  );
  const severity =
    changedFields.includes("statusCode") && current.statusCode >= 500
      ? "CRITICAL"
      : baseSeverity;
  return {
    severity,
    changedFields,
    beforeHash: canonicalJsonSha256("crawl-page-snapshot.v1", before),
    afterHash: canonicalJsonSha256("crawl-page-snapshot.v1", after),
    diffHash: canonicalJsonSha256("crawl-page-change.v1", diff),
    diff
  };
}

function comparablePrevious(
  snapshot: CrawlChangeSnapshot
): ComparableSnapshot {
  return {
    statusCode: snapshot.statusCode,
    redirectChain: jsonArray(snapshot.redirectChain),
    inSitemap: snapshot.inSitemap,
    responseTimeMs: snapshot.responseTimeMs,
    sizeBytes: snapshot.sizeBytes,
    title: snapshot.title,
    description: snapshot.description,
    h1: snapshot.h1,
    h1Count: snapshot.h1Count,
    canonicalUrl: snapshot.canonicalUrl,
    robots: snapshot.robots,
    language: snapshot.language,
    headings: jsonArray(snapshot.headings),
    hreflang: sortedObjects(jsonArray(snapshot.hreflang)),
    internalLinks: sortedStrings(jsonArray(snapshot.internalLinks)),
    externalLinks: sortedStrings(jsonArray(snapshot.externalLinks)),
    imageCount: snapshot.imageCount,
    imagesMissingAlt: snapshot.imagesMissingAlt,
    structuredDataTypes: sortedStrings(
      jsonArray(snapshot.structuredDataTypes)
    ),
    wordCount: snapshot.wordCount,
    contentHash: snapshot.contentHash,
    indexability: snapshot.indexability
  };
}

function comparableCurrent(
  snapshot: InternalPersistCrawlPageInput
): ComparableSnapshot {
  return {
    statusCode: snapshot.statusCode,
    redirectChain: [...snapshot.redirectChain],
    inSitemap: snapshot.inSitemap,
    responseTimeMs: snapshot.responseTimeMs,
    sizeBytes: snapshot.sizeBytes,
    title: snapshot.title ?? null,
    description: snapshot.description ?? null,
    h1: snapshot.h1 ?? null,
    h1Count: snapshot.h1Count,
    canonicalUrl: snapshot.canonicalUrl ?? null,
    robots: snapshot.robots ?? null,
    language: snapshot.language ?? null,
    headings: [...snapshot.headings],
    hreflang: sortedObjects(snapshot.hreflang),
    internalLinks: sortedStrings(snapshot.internalLinks),
    externalLinks: sortedStrings(snapshot.externalLinks),
    imageCount: snapshot.imageCount,
    imagesMissingAlt: snapshot.imagesMissingAlt,
    structuredDataTypes: sortedStrings(snapshot.structuredDataTypes),
    wordCount: snapshot.wordCount,
    contentHash: snapshot.contentHash,
    indexability: snapshot.indexability
  };
}

function meaningfulChange(
  field: CrawlPageChangeField,
  before: unknown,
  after: unknown
): boolean {
  if (canonicalJsonSha256("crawl-page-field.v1", before) ===
      canonicalJsonSha256("crawl-page-field.v1", after)) {
    return false;
  }
  if (field === "responseTimeMs") {
    return thresholdChange(Number(before), Number(after), 500, 0.5);
  }
  if (field === "sizeBytes") {
    return thresholdChange(Number(before), Number(after), 1_024, 0.1);
  }
  if (field === "wordCount") {
    return thresholdChange(Number(before), Number(after), 10, 0.1);
  }
  return true;
}

function thresholdChange(
  before: number,
  after: number,
  minimumDelta: number,
  minimumRatio: number
): boolean {
  const delta = Math.abs(after - before);
  return (
    delta >= minimumDelta &&
    delta / Math.max(1, Math.abs(before)) >= minimumRatio
  );
}

function normalizedFieldDiff(
  field: CrawlPageChangeField,
  before: unknown,
  after: unknown
): Readonly<Record<string, unknown>> {
  if (COMPLEX_FIELDS.has(field)) {
    const beforeArray = jsonArray(before);
    const afterArray = jsonArray(after);
    return {
      field,
      beforeHash: canonicalJsonSha256("crawl-page-field.v1", beforeArray),
      afterHash: canonicalJsonSha256("crawl-page-field.v1", afterArray),
      beforeCount: beforeArray.length,
      afterCount: afterArray.length
    };
  }
  return { field, before, after };
}

function jsonArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Stored crawl snapshot contains invalid JSON");
  }
  return value;
}

function sortedStrings(value: readonly unknown[]): readonly string[] {
  if (value.some((item) => typeof item !== "string")) {
    throw new TypeError("Stored crawl snapshot contains invalid string array");
  }
  return [...new Set(value as readonly string[])].sort();
}

function sortedObjects(value: readonly unknown[]): readonly unknown[] {
  return [...value].sort((left, right) =>
    canonicalJsonSha256("crawl-page-field.v1", left).localeCompare(
      canonicalJsonSha256("crawl-page-field.v1", right)
    )
  );
}
