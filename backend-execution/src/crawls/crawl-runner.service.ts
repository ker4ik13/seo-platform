import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  InternalPersistCrawlPageInput,
  InternalPersistCrawlPageReceipt,
  TechnicalCrawlConfig
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { CrawlSnapshotClient } from "../seo-data/crawl-snapshot.client.js";
import {
  analyzeHtmlPage,
  type CrawlPageAnalysis
} from "./html-analysis.js";
import {
  crawlScopeAllows,
  normalizedScopeUrl
} from "./crawl-scope.js";
import { crawlMembershipScopeHash } from "./crawl-membership-scope.js";
import {
  fetchPublicResource,
  PublicFetchError,
  type PublicFetchResult
} from "./public-http.js";
import { robotsAllows } from "./robots.js";
import {
  CrawlHostStateService,
  type CrawlHostFailureCode
} from "./crawl-host-state.service.js";
import { CrawlService } from "./crawl.service.js";
import {
  parseSitemapXml,
  sitemapBodyText
} from "./sitemap.js";

interface PendingUrl {
  readonly url: string;
  readonly depth: number;
  readonly inSitemap: boolean;
}

@Injectable()
export class CrawlRunnerService {
  private readonly logger = new Logger(CrawlRunnerService.name);

  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly crawls: CrawlService,
    private readonly snapshots: CrawlSnapshotClient,
    private readonly hostStates: CrawlHostStateService
  ) {}

  public async process(
    crawlId: string,
    leaseOwner: string,
    finalAttempt = false
  ): Promise<void> {
    const leaseSeconds = this.config.crawl.leaseSeconds;
    const crawl = await this.crawls.claim(crawlId, leaseOwner, leaseSeconds);
    if (!crawl) return;
    const crawlConfig = this.crawls.config(crawl);
    const deadline = new Date(
      (crawl.startedAt ?? new Date()).getTime() +
        crawlConfig.maxRuntimeSeconds * 1_000
    );
    const origin = new URL(crawlConfig.startUrls[0]!).origin;
    const host = new URL(origin).hostname;
    const checkpoint = this.crawls.checkpoint(crawl);
    const pending: PendingUrl[] = [...checkpoint.pending];
    const seen = new Set(checkpoint.seen);
    const sitemapPending = [...checkpoint.sitemapPending];
    const sitemapSeen = new Set(checkpoint.sitemapSeen);
    let scopeReady = checkpoint.scopeReady;
    const paceRequest = requestPacer(
      crawlConfig.requestsPerMinute,
      deadline
    );
    let sequence = crawl.processedUrls;
    let failureCode = "CRAWL_EXECUTION_FAILED";
    try {
      assertCrawlRuntime(deadline);
      const existingBackoff = await this.hostStates.currentBackoff(host);
      if (existingBackoff) {
        await this.crawls.releaseForHostBackoff(
          crawl.id,
          leaseOwner,
          existingBackoff.until,
          existingBackoff.code
        );
        return;
      }
      if (crawl.status === "CANCEL_REQUESTED") {
        await this.complete(
          crawl,
          crawlConfig,
          leaseOwner,
          "CANCELLED",
          sequence
        );
        return;
      }
      failureCode = "ROBOTS_UNAVAILABLE";
      const robots = await this.loadRobots(origin, paceRequest, deadline);
      if (!scopeReady) {
        failureCode = "SITEMAP_UNAVAILABLE";
        while (sitemapPending.length > 0) {
          await this.crawls.saveCheckpoint(
            crawl.id,
            leaseOwner,
            leaseSeconds,
            currentCheckpoint(
              pending,
              seen,
              sitemapPending,
              sitemapSeen,
              false
            )
          );
          const sitemapUrl = sitemapPending[0]!;
          let document;
          try {
            document = await this.loadSitemap(
              sitemapUrl,
              origin,
              crawlConfig,
              paceRequest,
              deadline
            );
          } catch (error) {
            if (
              crawlConfig.purpose !== "HTTP_STATUS_CHECK" ||
              error instanceof CrawlHostBackoffSignal ||
              (error instanceof PublicFetchError &&
                hostFailureFetchCodes.has(error.code))
            ) {
              throw error;
            }
            sitemapPending.shift();
            this.logger.warn("HTTP status check skipped unavailable sitemap");
            continue;
          }
          sitemapPending.shift();
          for (const nested of document.sitemapUrls) {
            const normalized = normalizedScopeUrl(nested, "PRESERVE");
            if (
              new URL(normalized).origin !== origin ||
              sitemapSeen.has(normalized)
            ) {
              continue;
            }
            if (sitemapSeen.size >= 20) {
              throw new Error("Sitemap document limit exceeded");
            }
            sitemapSeen.add(normalized);
            sitemapPending.push(normalized);
          }
          for (const pageUrl of document.pageUrls) {
            const normalized = normalizedScopeUrl(
              pageUrl,
              crawlConfig.queryPolicy
            );
            if (
              new URL(normalized).origin !== origin ||
              !crawlScopeAllows(normalized, crawlConfig)
            ) {
              continue;
            }
            if (seen.has(normalized)) {
              const index = pending.findIndex(
                ({ url }) => url === normalized
              );
              if (index >= 0 && !pending[index]!.inSitemap) {
                pending[index] = {
                  ...pending[index]!,
                  inSitemap: true
                };
              }
            } else if (seen.size < crawlConfig.maxUrls) {
              seen.add(normalized);
              pending.push({
                url: normalized,
                depth: 0,
                inSitemap: true
              });
            }
          }
          await this.crawls.saveCheckpoint(
            crawl.id,
            leaseOwner,
            leaseSeconds,
            currentCheckpoint(
              pending,
              seen,
              sitemapPending,
              sitemapSeen,
              false
            )
          );
        }
        sitemapPending.length = 0;
        scopeReady = true;
        await this.crawls.saveCheckpoint(
          crawl.id,
          leaseOwner,
          leaseSeconds,
          currentCheckpoint(
            pending,
            seen,
            sitemapPending,
            sitemapSeen,
            scopeReady
          )
        );
      }
      failureCode = "CRAWL_EXECUTION_FAILED";
      while (pending.length > 0 && sequence < crawlConfig.maxUrls) {
        if (await this.crawls.isCancellationRequested(crawlId)) {
          await this.complete(
            crawl,
            crawlConfig,
            leaseOwner,
            "CANCELLED",
            sequence
          );
          return;
        }
        const next = pending.shift()!;
        if (!robotsAllows(robots, new URL(next.url))) {
          await this.crawls.saveCheckpoint(
            crawl.id,
            leaseOwner,
            leaseSeconds,
            currentCheckpoint(
              pending,
              seen,
              sitemapPending,
              sitemapSeen,
              scopeReady
            )
          );
          continue;
        }
        await this.crawls.saveCheckpoint(
          crawl.id,
          leaseOwner,
          leaseSeconds,
          currentCheckpoint(
            [next, ...pending],
            seen,
            sitemapPending,
            sitemapSeen,
            scopeReady
          )
        );
        sequence += 1;
        let issueCount = 0;
        let success = false;
        let responseBackoffUntil: Date | undefined;
        try {
          const validator = crawlConfig.purpose === "HTTP_STATUS_CHECK"
            ? null
            : await this.snapshots.validator({
                workspaceId: crawl.workspaceId,
                projectId: crawl.projectId,
                url: next.url
              });
          const response = await fetchPublicResource(next.url, {
            timeoutMs: remainingRequestTimeout(
              deadline,
              this.config.crawl.requestTimeoutMs
            ),
            maxBytes: this.config.crawl.maxResponseBytes,
            maxRedirects: this.config.crawl.maxRedirects,
            accept: "text/html,application/xhtml+xml;q=0.9",
            allowedContentTypes: ["text/html", "application/xhtml+xml"],
            ...(crawlConfig.purpose === "HTTP_STATUS_CHECK"
              ? { acceptAnyContentType: true }
              : {}),
            userAgent: this.config.crawl.userAgent,
            beforeRequest: paceRequest,
            ...(validator
              ? {
                  conditional: {
                    ...(validator.etag
                      ? { etag: validator.etag }
                      : {}),
                    ...(validator.lastModified
                      ? { lastModified: validator.lastModified }
                      : {})
                  }
                }
              : {})
          });
          const normalizedFinalUrl = normalizedScopeUrl(
            response.finalUrl,
            crawlConfig.queryPolicy
          );
          if (
            (crawlConfig.purpose !== "HTTP_STATUS_CHECK" &&
              new URL(normalizedFinalUrl).origin !== origin) ||
            (
              crawlConfig.purpose !== "HTTP_STATUS_CHECK" &&
              !crawlScopeAllows(normalizedFinalUrl, crawlConfig) &&
              !crawlConfig.startUrls.includes(next.url)
            )
          ) {
            throw new PublicFetchError("INVALID_REDIRECT");
          }
          assertHostResponseAvailable(response);
          const crawledAt = new Date().toISOString();
          const redirectChain = response.redirectChain.map((url) =>
            normalizedScopeUrl(url, crawlConfig.queryPolicy)
          );
          let internalLinks: readonly string[];
          let receipt: InternalPersistCrawlPageReceipt;
          if (response.statusCode === 304) {
            if (!validator || response.redirectChain.length > 0) {
              throw new PublicFetchError("INVALID_NOT_MODIFIED");
            }
            receipt = await this.snapshots.reusePage({
              workspaceId: crawl.workspaceId,
              projectId: crawl.projectId,
              crawlId: crawl.id,
              sequence,
              sourceSnapshotId: validator.sourceSnapshotId,
              requestedUrl: response.requestedUrl,
              finalUrl: normalizedFinalUrl,
              redirectChain,
              inSitemap: next.inSitemap,
              depth: next.depth,
              crawledAt
            });
            internalLinks = validator.internalLinks;
          } else {
            const analysis = crawlPageAnalysis(
              response,
              normalizedFinalUrl,
              crawlConfig.purpose === "HTTP_STATUS_CHECK"
            );
            const payload: InternalPersistCrawlPageInput = {
              workspaceId: crawl.workspaceId,
              projectId: crawl.projectId,
              crawlId: crawl.id,
              purpose: crawlConfig.purpose,
              sequence,
              requestedUrl: response.requestedUrl,
              finalUrl: normalizedFinalUrl,
              redirectChain,
              inSitemap: next.inSitemap,
              depth: next.depth,
              statusCode: response.statusCode,
              responseTimeMs: response.responseTimeMs,
              sizeBytes: response.sizeBytes,
              contentType:
                response.contentType ??
                (crawlConfig.purpose === "HTTP_STATUS_CHECK"
                  ? "application/octet-stream"
                  : "text/html"),
              ...analysis,
              ...(crawlConfig.purpose === "HTTP_STATUS_CHECK"
                ? { issues: [] }
                : {}),
              ...(response.etag ? { etag: response.etag } : {}),
              ...(response.lastModified
                ? { lastModified: response.lastModified }
                : {}),
              crawledAt
            };
            receipt = await this.snapshots.persistPage(payload);
            internalLinks = analysis.internalLinks;
          }
          issueCount = receipt.issueCount;
          success = receipt.success;
          responseBackoffUntil =
            await this.hostStates.recordResponse(
              host,
              response.responseTimeMs
            );
          if (next.depth < crawlConfig.maxDepth) {
            for (const link of internalLinks) {
              const normalized = normalizedScopeUrl(
                link,
                crawlConfig.queryPolicy
              );
              if (
                new URL(normalized).origin === origin &&
                crawlScopeAllows(normalized, crawlConfig) &&
                !seen.has(normalized) &&
                seen.size < crawlConfig.maxUrls
              ) {
                seen.add(normalized);
                pending.push({
                  url: normalized,
                  depth: next.depth + 1,
                  inSitemap: false
                });
              }
            }
          }
        } catch (error) {
          if (error instanceof CrawlHostBackoffSignal) throw error;
          if (
            error instanceof PublicFetchError &&
            hostFailureFetchCodes.has(error.code)
          ) {
            throw new CrawlHostBackoffSignal(
              "HOST_NETWORK_ERROR",
              undefined,
              undefined,
              { cause: error }
            );
          }
          if (!(error instanceof PublicFetchError)) throw error;
          this.logger.warn(
            `Crawl page failed code=${crawlErrorCode(error)}`
          );
        }
        await this.crawls.recordPage(
          crawl.id,
          leaseOwner,
          leaseSeconds,
          { success, issueCount },
          currentCheckpoint(
            pending,
            seen,
            sitemapPending,
            sitemapSeen,
            scopeReady
          )
        );
        if (responseBackoffUntil) {
          await this.crawls.releaseForHostBackoff(
            crawl.id,
            leaseOwner,
            responseBackoffUntil,
            "LATENCY_SPIKE"
          );
          return;
        }
      }
      const current = await this.crawls.get(
        crawl.workspaceId,
        crawl.projectId,
        crawl.id
      );
      await this.complete(
        crawl,
        crawlConfig,
        leaseOwner,
        current.status === "CANCEL_REQUESTED"
          ? "CANCELLED"
          : current.failedUrls > 0
            ? "PARTIALLY_COMPLETED"
            : "COMPLETED",
        current.processedUrls
      );
    } catch (error) {
      if (error instanceof CrawlMaxRuntimeSignal) {
        const current = await this.crawls.get(
          crawl.workspaceId,
          crawl.projectId,
          crawl.id
        );
        await this.complete(
          crawl,
          crawlConfig,
          leaseOwner,
          "PARTIALLY_COMPLETED",
          current.processedUrls,
          "MAX_RUNTIME_EXCEEDED"
        );
        return;
      }
      const hostBackoff =
        error instanceof CrawlHostBackoffSignal
          ? error
          : error instanceof PublicFetchError &&
              hostFailureFetchCodes.has(error.code)
            ? new CrawlHostBackoffSignal(
                "HOST_NETWORK_ERROR",
                undefined,
                undefined,
                { cause: error }
              )
            : undefined;
      if (hostBackoff) {
        const backoffUntil = await this.hostStates.recordFailure(host, {
          code: hostBackoff.code,
          ...(hostBackoff.statusCode
            ? { statusCode: hostBackoff.statusCode }
            : {}),
          ...(hostBackoff.retryAfterMs !== undefined
            ? { retryAfterMs: hostBackoff.retryAfterMs }
            : {})
        });
        await this.crawls.releaseForHostBackoff(
          crawl.id,
          leaseOwner,
          backoffUntil,
          hostBackoff.code
        );
        return;
      }
      if (finalAttempt) {
        await this.crawls.fail(crawl.id, failureCode, leaseOwner);
        return;
      }
      await this.crawls.releaseForRetry(crawl.id, leaseOwner);
      throw new Error("Technical crawl retry scheduled");
    }
  }

  private async complete(
    crawl: {
      readonly id: string;
      readonly workspaceId: string;
      readonly projectId: string;
    },
    crawlConfig: TechnicalCrawlConfig,
    leaseOwner: string,
    status: "COMPLETED" | "PARTIALLY_COMPLETED" | "CANCELLED",
    processedUrls: number,
    failureCode?: string
  ): Promise<void> {
    const receipt = await this.snapshots.finalize({
      workspaceId: crawl.workspaceId,
      projectId: crawl.projectId,
      crawlId: crawl.id,
      purpose: crawlConfig.purpose,
      status,
      processedUrls,
      scopeHash: crawlMembershipScopeHash(crawlConfig)
    });
    await this.crawls.finish(
      crawl.id,
      leaseOwner,
      status,
      failureCode,
      receipt.issueCount
    );
  }

  private async loadRobots(
    origin: string,
    paceRequest: () => Promise<void>,
    deadline: Date
  ): Promise<string> {
    const response = await fetchPublicResource(`${origin}/robots.txt`, {
      timeoutMs: remainingRequestTimeout(
        deadline,
        this.config.crawl.requestTimeoutMs
      ),
      maxBytes: Math.min(this.config.crawl.maxResponseBytes, 1_000_000),
      maxRedirects: this.config.crawl.maxRedirects,
      accept: "text/plain,*/*;q=0.1",
      allowedContentTypes: ["text/plain", "text/html"],
      userAgent: this.config.crawl.userAgent,
      beforeRequest: paceRequest
    });
    assertHostResponseAvailable(response);
    if (response.statusCode === 404 || response.statusCode === 410) return "";
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error("robots unavailable");
    }
    return response.body.toString("utf8");
  }

  private async loadSitemap(
    sitemapUrl: string,
    origin: string,
    config: TechnicalCrawlConfig,
    paceRequest: () => Promise<void>,
    deadline: Date
  ) {
    const maxSitemapBytes = Math.min(
      this.config.crawl.maxResponseBytes,
      5_000_000
    );
    const response = await fetchPublicResource(sitemapUrl, {
      timeoutMs: remainingRequestTimeout(
        deadline,
        this.config.crawl.requestTimeoutMs
      ),
      maxBytes: maxSitemapBytes,
      maxRedirects: this.config.crawl.maxRedirects,
      accept:
        "application/xml,text/xml,application/gzip,application/x-gzip," +
        "text/plain;q=0.5,application/octet-stream;q=0.2",
      allowedContentTypes: [
        "application/xml",
        "text/xml",
        "text/plain",
        "application/rss+xml",
        "application/gzip",
        "application/x-gzip",
        "application/octet-stream"
      ],
      userAgent: this.config.crawl.userAgent,
      beforeRequest: paceRequest
    });
    assertHostResponseAvailable(response);
    if (
      response.statusCode < 200 ||
      response.statusCode >= 300 ||
      new URL(response.finalUrl).origin !== origin
    ) {
      throw new Error("Sitemap unavailable");
    }
    return parseSitemapXml(
      await sitemapBodyText(response.body, maxSitemapBytes),
      Math.max(config.maxUrls, 20)
    );
  }
}

function crawlPageAnalysis(
  response: PublicFetchResult,
  finalUrl: string,
  httpStatusOnly: boolean
): CrawlPageAnalysis {
  if (
    !httpStatusOnly ||
    response.contentType === "text/html" ||
    response.contentType === "application/xhtml+xml"
  ) {
    return analyzeHtmlPage({
      html: response.body.toString("utf8"),
      finalUrl,
      statusCode: response.statusCode,
      responseTimeMs: response.responseTimeMs,
      sizeBytes: response.sizeBytes
    });
  }
  return {
    h1Count: 0,
    headings: [],
    hreflang: [],
    internalLinks: [],
    externalLinks: [],
    imageCount: 0,
    imagesMissingAlt: 0,
    structuredDataTypes: [],
    wordCount: 0,
    contentHash: createHash("sha256").update(response.body).digest("hex"),
    indexability:
      response.statusCode >= 400
        ? "ERROR"
        : response.redirectChain.length > 0
          ? "REDIRECTED"
          : "UNKNOWN",
    issues: []
  };
}

function currentCheckpoint(
  pending: readonly PendingUrl[],
  seen: ReadonlySet<string>,
  sitemapPending: readonly string[] = [],
  sitemapSeen: ReadonlySet<string> = new Set(),
  scopeReady = true
) {
  return {
    version: 2 as const,
    pending: pending.map(({ url, depth, inSitemap }) => ({
      url,
      depth,
      inSitemap
    })),
    seen: [...seen],
    sitemapPending: [...sitemapPending],
    sitemapSeen: [...sitemapSeen],
    scopeReady
  };
}

function crawlErrorCode(error: unknown): string {
  return error instanceof PublicFetchError ? error.code : "PERSISTENCE_ERROR";
}

const hostFailureFetchCodes = new Set([
  "DNS_FAILED",
  "TIMEOUT",
  "NETWORK_ERROR"
]);

function assertHostResponseAvailable(
  response: Pick<
    PublicFetchResult,
    "statusCode" | "retryAfterMs"
  >
): void {
  if (response.statusCode === 429) {
    throw new CrawlHostBackoffSignal(
      "HOST_RATE_LIMIT",
      429,
      response.retryAfterMs
    );
  }
  if (response.statusCode === 503) {
    throw new CrawlHostBackoffSignal(
      "HOST_UNAVAILABLE",
      503,
      response.retryAfterMs
    );
  }
}

class CrawlHostBackoffSignal extends Error {
  public constructor(
    public readonly code: CrawlHostFailureCode,
    public readonly statusCode?: number,
    public readonly retryAfterMs?: number,
    options?: ErrorOptions
  ) {
    super(code, options);
    this.name = "CrawlHostBackoffSignal";
  }
}

class CrawlMaxRuntimeSignal extends Error {
  public constructor() {
    super("MAX_RUNTIME_EXCEEDED");
    this.name = "CrawlMaxRuntimeSignal";
  }
}

function requestPacer(
  requestsPerMinute: number,
  deadline: Date
): () => Promise<void> {
  const intervalMs = Math.ceil(60_000 / requestsPerMinute);
  let nextRequestAt = 0;
  return async () => {
    assertCrawlRuntime(deadline);
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (Date.now() + waitMs >= deadline.getTime()) {
      throw new CrawlMaxRuntimeSignal();
    }
    nextRequestAt = Math.max(nextRequestAt, Date.now()) + intervalMs;
    if (waitMs === 0) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, waitMs);
    });
  };
}

function remainingRequestTimeout(deadline: Date, configuredMs: number): number {
  assertCrawlRuntime(deadline);
  return Math.max(
    1,
    Math.min(configuredMs, deadline.getTime() - Date.now())
  );
}

function assertCrawlRuntime(deadline: Date): void {
  if (Number.isNaN(deadline.getTime()) || Date.now() >= deadline.getTime()) {
    throw new CrawlMaxRuntimeSignal();
  }
}
