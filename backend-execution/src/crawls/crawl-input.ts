import { BadRequestException } from "@nestjs/common";
import {
  technicalCrawlMaxRequestsPerMinute,
  technicalCrawlMaxUrlLimit,
  technicalCrawlHomepageChecks,
  technicalCrawlHomepageProbeUrls,
  technicalCrawlPurposes,
  technicalCrawlQueryPolicies,
  technicalCrawlStartUrlLimit,
  type TechnicalCrawlPurpose,
  type TechnicalCrawlHomepageCheck,
  type TechnicalCrawlQueryPolicy,
  type InternalCancelTechnicalCrawlInput,
  type InternalCreateTechnicalCrawlInput,
  type TechnicalCrawlConfig
} from "@seo-platform/contracts";
import { assertSafeCrawlUrl } from "./public-http.js";
import {
  normalizedScopeUrl,
  validCrawlPathPattern
} from "./crawl-scope.js";
import { jobCapacityInput } from "../jobs/job-capacity-input.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,180}$/u;

export function internalCreateTechnicalCrawlInput(
  value: unknown
): InternalCreateTechnicalCrawlInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "idempotencyKey",
    "correlationId",
    "purpose",
    "startUrls",
    "homepageChecks",
    "sitemapUrls",
    "includePatterns",
    "excludePatterns",
    "queryPolicy",
    "maxUrls",
    "maxDepth",
    "maxRuntimeSeconds",
    "requestsPerMinute",
    "obeyRobots",
    "jobCapacity"
  ]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    idempotencyKey: patternString(
      input.idempotencyKey,
      "idempotencyKey",
      KEY_PATTERN
    ),
    correlationId: boundedString(input.correlationId, "correlationId", 100),
    jobCapacity: jobCapacityInput(input.jobCapacity),
    ...crawlConfig(input)
  };
}

export function internalCancelTechnicalCrawlInput(
  value: unknown
): InternalCancelTechnicalCrawlInput {
  const input = record(value, [
    "workspaceId",
    "projectId",
    "actorId",
    "version"
  ]);
  return {
    workspaceId: uuid(input.workspaceId, "workspaceId"),
    projectId: uuid(input.projectId, "projectId"),
    actorId: uuid(input.actorId, "actorId"),
    version: integer(input.version, "version", 1, Number.MAX_SAFE_INTEGER)
  };
}

export function crawlConfig(
  value: Readonly<Record<string, unknown>>
): TechnicalCrawlConfig {
  const queryPolicy = queryPolicyValue(
    value.queryPolicy ?? "DROP_TRACKING"
  );
  const purpose = purposeValue(value.purpose ?? "TECHNICAL_AUDIT");
  const homepageChecks = stringArray(
    value.homepageChecks ?? [],
    "homepageChecks",
    technicalCrawlHomepageChecks.length,
    homepageCheckValue
  ) as readonly TechnicalCrawlHomepageCheck[];
  if (!Array.isArray(value.startUrls) || value.startUrls.length < 1 ||
      value.startUrls.length > technicalCrawlStartUrlLimit) {
    invalid("startUrls");
  }
  const urls = value.startUrls.map((item, index) => {
    if (typeof item !== "string") invalid(`startUrls.${index}`);
    try {
      return normalizedScopeUrl(item, queryPolicy);
    } catch {
      invalid(`startUrls.${index}`);
    }
  });
  const origins = new Set(urls.map((url) => new URL(url).origin));
  const sitemapUrls = stringArray(
    value.sitemapUrls ?? [],
    "sitemapUrls",
    10,
    (item) => assertSafeCrawlUrl(item).toString()
  );
  for (const url of sitemapUrls) origins.add(new URL(url).origin);
  const includePatterns = patternArray(
    value.includePatterns ?? [],
    "includePatterns"
  );
  const excludePatterns = patternArray(
    value.excludePatterns ?? [],
    "excludePatterns"
  );
  if (origins.size !== 1 || new Set(urls).size !== urls.length) {
    invalid("startUrls");
  }
  if (purpose !== "HTTP_STATUS_CHECK" && homepageChecks.length > 0) {
    invalid("homepageChecks");
  }
  if (value.obeyRobots !== true) invalid("obeyRobots");
  const maxUrls = integer(
    value.maxUrls,
    "maxUrls",
    1,
    technicalCrawlMaxUrlLimit
  );
  if (
    new Set([
      ...urls,
      ...technicalCrawlHomepageProbeUrls(urls[0]!, homepageChecks)
    ]).size > maxUrls
  ) {
    invalid("maxUrls");
  }
  return {
    purpose,
    startUrls: urls,
    ...(homepageChecks.length > 0 ? { homepageChecks } : {}),
    sitemapUrls,
    includePatterns,
    excludePatterns,
    queryPolicy,
    maxUrls,
    maxDepth: integer(value.maxDepth, "maxDepth", 0, 10),
    maxRuntimeSeconds: integer(
      value.maxRuntimeSeconds ?? 3_600,
      "maxRuntimeSeconds",
      60,
      21_600
    ),
    requestsPerMinute: integer(
      value.requestsPerMinute,
      "requestsPerMinute",
      1,
      technicalCrawlMaxRequestsPerMinute
    ),
    obeyRobots: true
  };
}

function homepageCheckValue(value: string): TechnicalCrawlHomepageCheck {
  if (
    !technicalCrawlHomepageChecks.includes(
      value as TechnicalCrawlHomepageCheck
    )
  ) {
    invalid("homepageChecks");
  }
  return value as TechnicalCrawlHomepageCheck;
}

function purposeValue(value: unknown): TechnicalCrawlPurpose {
  if (
    typeof value !== "string" ||
    !technicalCrawlPurposes.includes(value as TechnicalCrawlPurpose)
  ) {
    invalid("purpose");
  }
  return value as TechnicalCrawlPurpose;
}

function stringArray(
  value: unknown,
  field: string,
  max: number,
  normalize: (value: string) => string
): readonly string[] {
  if (!Array.isArray(value) || value.length > max) invalid(field);
  const result = value.map((item, index) => {
    if (typeof item !== "string") invalid(`${field}.${index}`);
    try {
      return normalize(item);
    } catch {
      invalid(`${field}.${index}`);
    }
  });
  if (new Set(result).size !== result.length) invalid(field);
  return result;
}

function patternArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 20) invalid(field);
  const patterns = value.map((item, index) => {
    if (!validCrawlPathPattern(item)) invalid(`${field}.${index}`);
    return item;
  });
  if (new Set(patterns).size !== patterns.length) invalid(field);
  return patterns;
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

function record(
  value: unknown,
  keys: readonly string[]
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid("body");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !keys.includes(key))) invalid("body");
  return input;
}

function uuid(value: unknown, field: string): string {
  return patternString(value, field, UUID_PATTERN).toLowerCase();
}

function patternString(
  value: unknown,
  field: string,
  pattern: RegExp
): string {
  if (typeof value !== "string" || !pattern.test(value)) invalid(field);
  return value;
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") invalid(field);
  const normalized = value.trim();
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

function invalid(field: string): never {
  throw new BadRequestException(`Invalid technical crawl field: ${field}`);
}
