import {
  technicalCrawlQueryPolicies,
  type CreateTechnicalCrawlInput,
  type TechnicalCrawlQueryPolicy
} from "@seo-platform/contracts";
import { validationError } from "../common/domain-error.js";

export function createTechnicalCrawlInput(
  value: unknown
): CreateTechnicalCrawlInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const input = value as Readonly<Record<string, unknown>>;
  const keys = [
    "startUrls",
    "sitemapUrls",
    "includePatterns",
    "excludePatterns",
    "queryPolicy",
    "maxUrls",
    "maxDepth",
    "requestsPerMinute",
    "obeyRobots"
  ];
  if (
    Object.keys(input).some((key) => !keys.includes(key)) ||
    !Array.isArray(input.startUrls) ||
    input.startUrls.length < 1 ||
    input.startUrls.length > 20 ||
    !input.startUrls.every((url) => typeof url === "string")
  ) invalid("body");
  const startUrls = input.startUrls.map((value, index) =>
    publicUrl(value as string, `startUrls.${index}`)
  );
  const sitemapUrls = stringArray(
    input.sitemapUrls ?? [],
    "sitemapUrls",
    10,
    (value, field) => publicUrl(value, field)
  );
  const includePatterns = stringArray(
    input.includePatterns ?? [],
    "includePatterns",
    20,
    pathPattern
  );
  const excludePatterns = stringArray(
    input.excludePatterns ?? [],
    "excludePatterns",
    20,
    pathPattern
  );
  const queryPolicy = input.queryPolicy === undefined
    ? "DROP_TRACKING"
    : queryPolicyValue(input.queryPolicy);
  if (
    new Set(startUrls).size !== startUrls.length ||
    new Set([...startUrls, ...sitemapUrls].map(
      (url) => new URL(url).origin
    )).size !== 1
  ) invalid("startUrls");
  if (input.obeyRobots !== true) invalid("obeyRobots");
  return {
    startUrls,
    sitemapUrls,
    includePatterns,
    excludePatterns,
    queryPolicy,
    maxUrls: integer(input.maxUrls, "maxUrls", 1, 1_000),
    maxDepth: integer(input.maxDepth, "maxDepth", 0, 10),
    requestsPerMinute: integer(
      input.requestsPerMinute,
      "requestsPerMinute",
      1,
      60
    ),
    obeyRobots: true
  };
}

function stringArray(
  value: unknown,
  field: string,
  max: number,
  normalize: (value: string, field: string) => string
): readonly string[] {
  if (!Array.isArray(value) || value.length > max) invalid(field);
  const result = value.map((item, index) => {
    if (typeof item !== "string") invalid(`${field}.${index}`);
    return normalize(item, `${field}.${index}`);
  });
  if (new Set(result).size !== result.length) invalid(field);
  return result;
}

function pathPattern(value: string, field: string): string {
  const pattern = value.trim();
  if (
    !pattern.startsWith("/") ||
    pattern.length > 200 ||
    [...pattern].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f || character === "#";
    })
  ) {
    invalid(field);
  }
  return pattern;
}

function queryPolicyValue(value: unknown): TechnicalCrawlQueryPolicy {
  if (
    typeof value !== "string" ||
    !technicalCrawlQueryPolicies.includes(
      value as TechnicalCrawlQueryPolicy
    )
  ) {
    invalid("queryPolicy");
  }
  return value as TechnicalCrawlQueryPolicy;
}

export function assertEmptyCrawlCancelInput(value: unknown): void {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 0
  ) {
    invalid("body");
  }
}

function publicUrl(value: string, field: string): string {
  const source = value.trim();
  if (!source || source.length > 4_096) invalid(field);
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    invalid(field);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port &&
      !(
        (url.protocol === "http:" && url.port === "80") ||
        (url.protocol === "https:" && url.port === "443")
      ))
  ) invalid(field);
  url.hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  return url.toString();
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

function invalid(field: string): never {
  throw validationError(
    field,
    "INVALID_CRAWL_FIELD",
    `Invalid technical crawl field: ${field}`
  );
}
