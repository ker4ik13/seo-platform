import {
  technicalCrawlMaxRequestsPerMinute,
  technicalCrawlMaxUrlLimit,
  technicalCrawlHomepageChecks,
  technicalCrawlHomepageProbeUrls,
  technicalCrawlPurposes,
  technicalCrawlQueryPolicies,
  technicalCrawlStartUrlLimit,
  type TechnicalCrawlConfig,
  type TechnicalCrawlHomepageCheck,
  type TechnicalCrawlPurpose,
  type TechnicalCrawlQueryPolicy,
  type TechnicalCrawlSummary
} from "@seo-platform/contracts";
import type { Prisma, TechnicalCrawl } from "../generated/prisma/client.js";
import {
  normalizedScopeUrl,
  validCrawlPathPattern
} from "./crawl-scope.js";
import { assertSafeCrawlUrl } from "./public-http.js";

export function storedCrawlConfig(value: Prisma.JsonValue): TechnicalCrawlConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Stored crawl config is invalid");
  }
  const input = value as Readonly<Record<string, unknown>>;
  const queryPolicy = input.queryPolicy ?? "DROP_TRACKING";
  const purpose = input.purpose ?? "TECHNICAL_AUDIT";
  const homepageChecks = input.homepageChecks ?? [];
  const sitemapUrls = input.sitemapUrls ?? [];
  const includePatterns = input.includePatterns ?? [];
  const excludePatterns = input.excludePatterns ?? [];
  if (
    !Array.isArray(input.startUrls) ||
    !input.startUrls.every((item) => typeof item === "string") ||
    input.startUrls.length < 1 ||
    input.startUrls.length > technicalCrawlStartUrlLimit ||
    !Array.isArray(homepageChecks) ||
    homepageChecks.length > technicalCrawlHomepageChecks.length ||
    !homepageChecks.every(
      (item) =>
        typeof item === "string" &&
        technicalCrawlHomepageChecks.includes(
          item as TechnicalCrawlHomepageCheck
        )
    ) ||
    !Array.isArray(sitemapUrls) ||
    sitemapUrls.length > 10 ||
    !sitemapUrls.every((item) => typeof item === "string") ||
    !Array.isArray(includePatterns) ||
    includePatterns.length > 20 ||
    !includePatterns.every(validCrawlPathPattern) ||
    !Array.isArray(excludePatterns) ||
    excludePatterns.length > 20 ||
    !excludePatterns.every(validCrawlPathPattern) ||
    typeof queryPolicy !== "string" ||
    !technicalCrawlQueryPolicies.includes(
      queryPolicy as TechnicalCrawlQueryPolicy
    ) ||
    typeof purpose !== "string" ||
    !technicalCrawlPurposes.includes(purpose as TechnicalCrawlPurpose) ||
    (purpose !== "HTTP_STATUS_CHECK" && homepageChecks.length > 0) ||
    !Number.isSafeInteger(input.maxUrls) ||
    Number(input.maxUrls) < 1 ||
    Number(input.maxUrls) > technicalCrawlMaxUrlLimit ||
    !Number.isSafeInteger(input.maxDepth) ||
    Number(input.maxDepth) < 0 ||
    Number(input.maxDepth) > 10 ||
    (
      input.maxRuntimeSeconds !== undefined &&
      (
        !Number.isSafeInteger(input.maxRuntimeSeconds) ||
        Number(input.maxRuntimeSeconds) < 60 ||
        Number(input.maxRuntimeSeconds) > 21_600
      )
    ) ||
    !Number.isSafeInteger(input.requestsPerMinute) ||
    Number(input.requestsPerMinute) < 1 ||
    Number(input.requestsPerMinute) > technicalCrawlMaxRequestsPerMinute ||
    input.obeyRobots !== true
  ) {
    throw new TypeError("Stored crawl config is invalid");
  }
  let startUrls: readonly string[];
  let normalizedSitemapUrls: readonly string[];
  try {
    startUrls = (input.startUrls as readonly string[]).map((url) =>
      normalizedScopeUrl(url, queryPolicy as TechnicalCrawlQueryPolicy)
    );
    normalizedSitemapUrls = (sitemapUrls as readonly string[]).map((url) =>
      assertSafeCrawlUrl(url).toString()
    );
  } catch {
    throw new TypeError("Stored crawl config is invalid");
  }
  if (
    new Set(startUrls).size !== startUrls.length ||
    new Set(homepageChecks).size !== homepageChecks.length ||
    new Set([
      ...startUrls,
      ...technicalCrawlHomepageProbeUrls(
        startUrls[0]!,
        homepageChecks as readonly TechnicalCrawlHomepageCheck[]
      )
    ]).size > Number(input.maxUrls) ||
    new Set(normalizedSitemapUrls).size !== normalizedSitemapUrls.length ||
    new Set([...startUrls, ...normalizedSitemapUrls].map(
      (url) => new URL(url).origin
    )).size !== 1 ||
    new Set(includePatterns).size !== includePatterns.length ||
    new Set(excludePatterns).size !== excludePatterns.length
  ) {
    throw new TypeError("Stored crawl config is invalid");
  }
  return {
    purpose: purpose as TechnicalCrawlPurpose,
    startUrls,
    ...(homepageChecks.length > 0
      ? {
          homepageChecks:
            homepageChecks as readonly TechnicalCrawlHomepageCheck[]
        }
      : {}),
    sitemapUrls: normalizedSitemapUrls,
    includePatterns: includePatterns as readonly string[],
    excludePatterns: excludePatterns as readonly string[],
    queryPolicy: queryPolicy as TechnicalCrawlQueryPolicy,
    maxUrls: Number(input.maxUrls),
    maxDepth: Number(input.maxDepth),
    maxRuntimeSeconds: Number(input.maxRuntimeSeconds ?? 3_600),
    requestsPerMinute: Number(input.requestsPerMinute),
    obeyRobots: true
  };
}

export function technicalCrawlSummary(
  crawl: TechnicalCrawl
): TechnicalCrawlSummary {
  if (
    (
      crawl.backoffCode !== null &&
      ![
        "HOST_RATE_LIMIT",
        "HOST_UNAVAILABLE",
        "HOST_NETWORK_ERROR",
        "LATENCY_SPIKE",
        "SITE_PAUSED"
      ].includes(crawl.backoffCode)
    ) ||
    (crawl.backoffCode === null) !== (crawl.backoffUntil === null)
  ) {
    throw new TypeError("Stored crawl backoff state is invalid");
  }
  return {
    id: crawl.id,
    jobId: crawl.jobId,
    workspaceId: crawl.workspaceId,
    projectId: crawl.projectId,
    status: crawl.status,
    config: storedCrawlConfig(crawl.config),
    discoveredUrls: crawl.discoveredUrls,
    processedUrls: crawl.processedUrls,
    successfulUrls: crawl.successfulUrls,
    failedUrls: crawl.failedUrls,
    issueCount: crawl.issueCount,
    ...(crawl.failureCode ? { failureCode: crawl.failureCode } : {}),
    ...(crawl.backoffCode
      ? {
          backoffCode:
            crawl.backoffCode as Exclude<
              TechnicalCrawlSummary["backoffCode"],
              undefined
            >
        }
      : {}),
    ...(crawl.backoffUntil
      ? { backoffUntil: crawl.backoffUntil.toISOString() }
      : {}),
    version: crawl.version,
    createdAt: crawl.createdAt.toISOString(),
    ...(crawl.startedAt ? { startedAt: crawl.startedAt.toISOString() } : {}),
    ...(crawl.finishedAt ? { finishedAt: crawl.finishedAt.toISOString() } : {}),
    ...(crawl.cancelRequestedAt
      ? { cancelRequestedAt: crawl.cancelRequestedAt.toISOString() }
      : {})
  };
}
