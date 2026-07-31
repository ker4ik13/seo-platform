import type {
  TechnicalCrawlConfig,
  TechnicalCrawlSummary
} from "@seo-platform/contracts";
import type { Prisma, TechnicalCrawl } from "../generated/prisma/client.js";

export function storedCrawlConfig(value: Prisma.JsonValue): TechnicalCrawlConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Stored crawl config is invalid");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    !Array.isArray(input.startUrls) ||
    !input.startUrls.every((item) => typeof item === "string") ||
    !Number.isSafeInteger(input.maxUrls) ||
    !Number.isSafeInteger(input.maxDepth) ||
    !Number.isSafeInteger(input.requestsPerMinute) ||
    input.obeyRobots !== true
  ) {
    throw new TypeError("Stored crawl config is invalid");
  }
  return {
    startUrls: input.startUrls,
    maxUrls: Number(input.maxUrls),
    maxDepth: Number(input.maxDepth),
    requestsPerMinute: Number(input.requestsPerMinute),
    obeyRobots: true
  };
}

export function technicalCrawlSummary(
  crawl: TechnicalCrawl
): TechnicalCrawlSummary {
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
    version: crawl.version,
    createdAt: crawl.createdAt.toISOString(),
    ...(crawl.startedAt ? { startedAt: crawl.startedAt.toISOString() } : {}),
    ...(crawl.finishedAt ? { finishedAt: crawl.finishedAt.toISOString() } : {}),
    ...(crawl.cancelRequestedAt
      ? { cancelRequestedAt: crawl.cancelRequestedAt.toISOString() }
      : {})
  };
}
