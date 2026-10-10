import { delay } from "./worker-http-client.js";

interface CrawlPaceState {
  previous: Promise<void>;
  nextAt: number;
  expiresAt: number;
}

/** One clock per crawl, shared by every HTTP slot and redirect on this agent. */
export class RemoteCrawlRequestPacer {
  private readonly crawls = new Map<string, CrawlPaceState>();

  public async wait(crawlId: string, requestsPerMinute: number, deadline: number, signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    for (const [id, entry] of this.crawls) if (entry.expiresAt < now) this.crawls.delete(id);
    let entry = this.crawls.get(crawlId);
    if (!entry) {
      entry = { previous: Promise.resolve(), nextAt: 0, expiresAt: deadline + 120000 };
      this.crawls.set(crawlId, entry);
    }
    entry.expiresAt = Math.max(entry.expiresAt, deadline + 120000);
    const current = entry;
    const request = current.previous.then(async () => {
      if (signal?.aborted) throw new Error("Crawl request cancelled");
      await delay(Math.max(0, current.nextAt - Date.now()));
      if (signal?.aborted || Date.now() >= deadline) throw new Error("Crawl request expired");
      current.nextAt = Date.now() + Math.ceil(60000 / requestsPerMinute);
    });
    current.previous = request.catch(() => undefined);
    return request;
  }
}
