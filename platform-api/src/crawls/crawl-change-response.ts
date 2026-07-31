import {
  crawlPageChangeFields,
  type CrawlPageChangeField,
  type ProjectCrawlPageChangeCollection,
  type ProjectCrawlPageChangeSummary
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SEVERITIES = new Set(["INFO", "WARNING", "ERROR", "CRITICAL"]);
const FIELDS = new Set<string>(crawlPageChangeFields);

export function crawlPageChangeCollection(
  value: unknown
): ProjectCrawlPageChangeCollection {
  const input = record(value);
  if (
    Object.keys(input).length !== 1 ||
    !Array.isArray(input.changes) ||
    input.changes.length > 500
  ) invalid();
  return { changes: input.changes.map(change) };
}

function change(value: unknown): ProjectCrawlPageChangeSummary {
  const input = record(value);
  const keys = [
    "id", "crawlId", "pageId", "url", "severity", "changedFields",
    "previousCrawledAt", "currentCrawledAt", "createdAt"
  ];
  const changedFields = input.changedFields;
  if (
    Object.keys(input).length !== keys.length ||
    keys.some((key) => !(key in input)) ||
    !uuid(input.id) ||
    !uuid(input.crawlId) ||
    !uuid(input.pageId) ||
    !text(input.url, 4_096) ||
    !SEVERITIES.has(String(input.severity)) ||
    !Array.isArray(changedFields) ||
    changedFields.length < 1 ||
    changedFields.length > 24 ||
    changedFields.some(
      (field) => typeof field !== "string" || !FIELDS.has(field)
    ) ||
    new Set(changedFields).size !== changedFields.length ||
    !date(input.previousCrawledAt) ||
    !date(input.currentCrawledAt) ||
    !date(input.createdAt)
  ) invalid();
  return {
    id: input.id as string,
    crawlId: input.crawlId as string,
    pageId: input.pageId as string,
    url: input.url as string,
    severity: input.severity as ProjectCrawlPageChangeSummary["severity"],
    changedFields: changedFields as CrawlPageChangeField[],
    previousCrawledAt: input.previousCrawledAt as string,
    currentCrawledAt: input.currentCrawledAt as string,
    createdAt: input.createdAt as string
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

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function date(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function invalid(): never {
  throw new DomainError({
    statusCode: 502,
    code: "DEPENDENCY_UNAVAILABLE",
    message: "SEO Data returned an invalid crawl change response",
    retryable: true
  });
}
