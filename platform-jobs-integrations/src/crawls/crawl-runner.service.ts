import { Inject, Injectable, Logger } from "@nestjs/common";
import type { InternalPersistCrawlPageInput } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { CrawlSnapshotClient } from "../seo-data/crawl-snapshot.client.js";
import { analyzeHtmlPage } from "./html-analysis.js";
import { fetchPublicResource, PublicFetchError } from "./public-http.js";
import { robotsAllows } from "./robots.js";
import { CrawlService } from "./crawl.service.js";

interface PendingUrl {
  readonly url: string;
  readonly depth: number;
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
    let sequence = crawl.processedUrls;
    let failureCode = "CRAWL_EXECUTION_FAILED";
    try {
      if (crawl.status === "CANCEL_REQUESTED") {
        await this.complete(crawl, leaseOwner, "CANCELLED", sequence);
        return;
      }
      failureCode = "ROBOTS_UNAVAILABLE";
      const robots = await this.loadRobots(origin);
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
            currentCheckpoint(pending, seen)
          );
          continue;
        }
        if (sequence > 0) {
          await delay(Math.ceil(60_000 / crawlConfig.requestsPerMinute));
        }
        await this.crawls.saveCheckpoint(
          crawl.id,
          leaseOwner,
          leaseSeconds,
          currentCheckpoint([next, ...pending], seen)
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
            userAgent: this.config.crawl.userAgent
          });
          if (new URL(response.finalUrl).origin !== origin) {
            throw new PublicFetchError("INVALID_REDIRECT");
          }
          const analysis = analyzeHtmlPage({
            html: response.body.toString("utf8"),
            finalUrl: response.finalUrl,
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
            finalUrl: response.finalUrl,
            redirectChain: response.redirectChain,
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
              const normalized = normalizedUrl(link);
              if (
                new URL(normalized).origin === origin &&
                !seen.has(normalized) &&
                seen.size < crawlConfig.maxUrls
              ) {
                seen.add(normalized);
                pending.push({ url: normalized, depth: next.depth + 1 });
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
          currentCheckpoint(pending, seen)
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

  private async loadRobots(origin: string): Promise<string> {
    const response = await fetchPublicResource(`${origin}/robots.txt`, {
      timeoutMs: this.config.crawl.requestTimeoutMs,
      maxBytes: Math.min(this.config.crawl.maxResponseBytes, 1_000_000),
      maxRedirects: this.config.crawl.maxRedirects,
      accept: "text/plain,*/*;q=0.1",
      allowedContentTypes: ["text/plain", "text/html"],
      userAgent: this.config.crawl.userAgent
    });
    if (response.statusCode === 404 || response.statusCode === 410) return "";
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error("robots unavailable");
    }
    return response.body.toString("utf8");
  }
}

function normalizedUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function currentCheckpoint(
  pending: readonly PendingUrl[],
  seen: ReadonlySet<string>
) {
  return {
    version: 1 as const,
    pending: pending.map(({ url, depth }) => ({ url, depth })),
    seen: [...seen]
  };
}

function crawlErrorCode(error: unknown): string {
  return error instanceof PublicFetchError ? error.code : "PERSISTENCE_ERROR";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
