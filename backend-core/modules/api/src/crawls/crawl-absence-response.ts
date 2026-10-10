import {
  technicalCrawlMaxUrlLimit,
  type ProjectCrawlAbsentPageCollection,
  type ProjectCrawlAbsentPageSummary
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function crawlAbsentPageCollection(
  value: unknown,
  expectedCrawlId: string
): ProjectCrawlAbsentPageCollection {
  const input = record(value);
  if (
    Object.keys(input).length !== 2 ||
    input.crawlId !== expectedCrawlId ||
    !Array.isArray(input.pages) ||
    input.pages.length > technicalCrawlMaxUrlLimit
  ) {
    invalid();
  }
  const pages = input.pages.map(page);
  if (
    new Set(pages.map(({ pageId }) => pageId)).size !== pages.length ||
    pages.some(({ previousCrawlId }) => previousCrawlId === expectedCrawlId)
  ) {
    invalid();
  }
  return { crawlId: expectedCrawlId, pages };
}

function page(value: unknown): ProjectCrawlAbsentPageSummary {
  const input = record(value);
  const keys = [
    "pageId",
    "url",
    "previousCrawlId",
    "previousSnapshotId",
    "wasInSitemap",
    "lastSeenAt",
    "detectedAt"
  ];
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !(key in input)) ||
    !uuid(input.pageId) ||
    !safeUrl(input.url) ||
    !uuid(input.previousCrawlId) ||
    !uuid(input.previousSnapshotId) ||
    typeof input.wasInSitemap !== "boolean" ||
    !date(input.lastSeenAt) ||
    !date(input.detectedAt) ||
    Date.parse(input.detectedAt) < Date.parse(input.lastSeenAt)
  ) {
    invalid();
  }
  return {
    pageId: input.pageId,
    url: input.url,
    previousCrawlId: input.previousCrawlId,
    previousSnapshotId: input.previousSnapshotId,
    wasInSitemap: input.wasInSitemap,
    lastSeenAt: input.lastSeenAt,
    detectedAt: input.detectedAt
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function safeUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 4 || value.length > 4_096) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

function date(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === value
  );
}

function invalid(): never {
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "SEO Data returned an invalid crawl absence response",
    retryable: true
  });
}
