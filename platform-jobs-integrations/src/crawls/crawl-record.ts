import {
  technicalCrawlQueryPolicies,
  type TechnicalCrawlConfig,
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
  const sitemapUrls = input.sitemapUrls ?? [];
  const includePatterns = input.includePatterns ?? [];
  const excludePatterns = input.excludePatterns ?? [];
  if (
    !Array.isArray(input.startUrls) ||
    !input.startUrls.every((item) => typeof item === "string") ||
    input.startUrls.length < 1 ||
    input.startUrls.length > 20 ||
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
    !Number.isSafeInteger(input.maxUrls) ||
    Number(input.maxUrls) < 1 ||
    Number(input.maxUrls) > 1_000 ||
    !Number.isSafeInteger(input.maxDepth) ||
    Number(input.maxDepth) < 0 ||
    Number(input.maxDepth) > 10 ||
    !Number.isSafeInteger(input.requestsPerMinute) ||
    Number(input.requestsPerMinute) < 1 ||
    Number(input.requestsPerMinute) > 60 ||
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
    startUrls,
    sitemapUrls: normalizedSitemapUrls,
    includePatterns: includePatterns as readonly string[],
    excludePatterns: excludePatterns as readonly string[],
    queryPolicy: queryPolicy as TechnicalCrawlQueryPolicy,
    maxUrls: Number(input.maxUrls),
    maxDepth: Number(input.maxDepth),
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
        "LATENCY_SPIKE"
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
