import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  InternalPersistCrawlPageInput,
  TechnicalCrawlConfig
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { CrawlSnapshotClient } from "../seo-data/crawl-snapshot.client.js";
import { analyzeHtmlPage } from "./html-analysis.js";
import {
  crawlScopeAllows,
  normalizedScopeUrl
} from "./crawl-scope.js";
import { fetchPublicResource, PublicFetchError } from "./public-http.js";
import { robotsAllows } from "./robots.js";
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
    private readonly snapshots: CrawlSnapshotClient
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
    const origin = new URL(crawlConfig.startUrls[0]!).origin;
    const checkpoint = this.crawls.checkpoint(crawl);
    const pending: PendingUrl[] = [...checkpoint.pending];
    const seen = new Set(checkpoint.seen);
    const sitemapPending = [...checkpoint.sitemapPending];
    const sitemapSeen = new Set(checkpoint.sitemapSeen);
    let scopeReady = checkpoint.scopeReady;
    const paceRequest = requestPacer(crawlConfig.requestsPerMinute);
    let sequence = crawl.processedUrls;
    let failureCode = "CRAWL_EXECUTION_FAILED";
    try {
      if (crawl.status === "CANCEL_REQUESTED") {
        await this.complete(crawl, leaseOwner, "CANCELLED", sequence);
        return;
      }
      failureCode = "ROBOTS_UNAVAILABLE";
      const robots = await this.loadRobots(origin, paceRequest);
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
          const document = await this.loadSitemap(
            sitemapUrl,
            origin,
            crawlConfig,
            paceRequest
          );
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
        try {
          const response = await fetchPublicResource(next.url, {
            timeoutMs: this.config.crawl.requestTimeoutMs,
            maxBytes: this.config.crawl.maxResponseBytes,
            maxRedirects: this.config.crawl.maxRedirects,
            accept: "text/html,application/xhtml+xml;q=0.9",
            allowedContentTypes: ["text/html", "application/xhtml+xml"],
            userAgent: this.config.crawl.userAgent,
            beforeRequest: paceRequest
          });
          const normalizedFinalUrl = normalizedScopeUrl(
            response.finalUrl,
            crawlConfig.queryPolicy
          );
          if (
            new URL(normalizedFinalUrl).origin !== origin ||
            (
              !crawlScopeAllows(normalizedFinalUrl, crawlConfig) &&
              !crawlConfig.startUrls.includes(next.url)
            )
          ) {
            throw new PublicFetchError("INVALID_REDIRECT");
          }
          const analysis = analyzeHtmlPage({
            html: response.body.toString("utf8"),
            finalUrl: normalizedFinalUrl,
            statusCode: response.statusCode,
            responseTimeMs: response.responseTimeMs,
            sizeBytes: response.sizeBytes
          });
          const crawledAt = new Date().toISOString();
          const payload: InternalPersistCrawlPageInput = {
            workspaceId: crawl.workspaceId,
            projectId: crawl.projectId,
            crawlId: crawl.id,
            sequence,
            requestedUrl: response.requestedUrl,
            finalUrl: normalizedFinalUrl,
            redirectChain: response.redirectChain.map((url) =>
              normalizedScopeUrl(url, crawlConfig.queryPolicy)
            ),
            inSitemap: next.inSitemap,
            depth: next.depth,
            statusCode: response.statusCode,
            responseTimeMs: response.responseTimeMs,
            sizeBytes: response.sizeBytes,
            contentType: response.contentType ?? "text/html",
            ...analysis,
            crawledAt
          };
          const receipt = await this.snapshots.persistPage(payload);
          issueCount = receipt.issueCount;
          success = receipt.success;
          if (next.depth < crawlConfig.maxDepth) {
            for (const link of analysis.internalLinks) {
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
      }
      const current = await this.crawls.get(
        crawl.workspaceId,
        crawl.projectId,
        crawl.id
      );
      await this.complete(
        crawl,
        leaseOwner,
        current.status === "CANCEL_REQUESTED"
          ? "CANCELLED"
          : current.failedUrls > 0
            ? "PARTIALLY_COMPLETED"
            : "COMPLETED",
        current.processedUrls
      );
    } catch {
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
    leaseOwner: string,
    status: "COMPLETED" | "PARTIALLY_COMPLETED" | "CANCELLED",
    processedUrls: number
  ): Promise<void> {
    await this.snapshots.finalize({
      workspaceId: crawl.workspaceId,
      projectId: crawl.projectId,
      crawlId: crawl.id,
      status,
      processedUrls
    });
    await this.crawls.finish(crawl.id, leaseOwner, status);
  }

  private async loadRobots(
    origin: string,
    paceRequest: () => Promise<void>
  ): Promise<string> {
    const response = await fetchPublicResource(`${origin}/robots.txt`, {
      timeoutMs: this.config.crawl.requestTimeoutMs,
      maxBytes: Math.min(this.config.crawl.maxResponseBytes, 1_000_000),
      maxRedirects: this.config.crawl.maxRedirects,
      accept: "text/plain,*/*;q=0.1",
      allowedContentTypes: ["text/plain", "text/html"],
      userAgent: this.config.crawl.userAgent,
      beforeRequest: paceRequest
    });
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
    paceRequest: () => Promise<void>
  ) {
    const maxSitemapBytes = Math.min(
      this.config.crawl.maxResponseBytes,
      5_000_000
    );
    const response = await fetchPublicResource(sitemapUrl, {
      timeoutMs: this.config.crawl.requestTimeoutMs,
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

function requestPacer(
  requestsPerMinute: number
): () => Promise<void> {
  const intervalMs = Math.ceil(60_000 / requestsPerMinute);
  let nextRequestAt = 0;
  return async () => {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    nextRequestAt = Math.max(nextRequestAt, Date.now()) + intervalMs;
    if (waitMs === 0) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, waitMs);
    });
  };
}
