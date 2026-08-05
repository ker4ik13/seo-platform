import type {
  ProjectCrawlIssueCollection,
  ProjectCrawlIssueSummary
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SEVERITIES = new Set(["INFO", "WARNING", "ERROR", "CRITICAL"]);

export function crawlIssueCollection(
  value: unknown
): ProjectCrawlIssueCollection {
  const input = record(value);
  if (
    Object.keys(input).length !== 1 ||
    !Array.isArray(input.issues) ||
    input.issues.length > 500
  ) invalid();
  return { issues: input.issues.map(crawlIssue) };
}

function crawlIssue(value: unknown): ProjectCrawlIssueSummary {
  const input = record(value);
  const required = [
    "id", "crawlId", "pageId", "url", "code", "severity", "title",
    "details", "firstSeenAt", "lastSeenAt", "occurrences"
  ];
  const optional = ["resolvedAt"];
  if (
    required.some((key) => !(key in input)) ||
    Object.keys(input).some(
      (key) => !required.includes(key) && !optional.includes(key)
    ) ||
    !uuid(input.id) ||
    !uuid(input.crawlId) ||
    !uuid(input.pageId) ||
    !text(input.url, 4_096) ||
    !text(input.code, 64) ||
    !SEVERITIES.has(String(input.severity)) ||
    !text(input.title, 255) ||
    !date(input.firstSeenAt) ||
    !date(input.lastSeenAt) ||
    !Number.isSafeInteger(input.occurrences) ||
    Number(input.occurrences) < 1 ||
    (input.resolvedAt !== undefined && !date(input.resolvedAt))
  ) invalid();
  const details = scalarRecord(input.details);
  return {
    id: input.id as string,
    crawlId: input.crawlId as string,
    pageId: input.pageId as string,
    url: input.url as string,
    code: input.code as string,
    severity: input.severity as ProjectCrawlIssueSummary["severity"],
    title: input.title as string,
    details,
    firstSeenAt: input.firstSeenAt as string,
    lastSeenAt: input.lastSeenAt as string,
    occurrences: Number(input.occurrences),
    ...(typeof input.resolvedAt === "string"
      ? { resolvedAt: input.resolvedAt }
      : {})
  };
}

function scalarRecord(
  value: unknown
): Readonly<Record<string, string | number | boolean>> {
  const input = record(value);
  if (
    Object.keys(input).length > 30 ||
    Object.values(input).some(
      (item) => !["string", "number", "boolean"].includes(typeof item)
    )
  ) invalid();
  return input as Readonly<Record<string, string | number | boolean>>;
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
    message: "SEO Data returned an invalid crawl issue response",
    retryable: true
  });
}
