interface CrawlPageKey {
  readonly url: string;
}

type FetchOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

/** Fetch ahead while the owning runner commits pages and checkpoints in order. */
export class CrawlPagePrefetch<Page extends CrawlPageKey, Result> {
  private readonly pending = new Map<string, Promise<FetchOutcome<Result>>>();
  private closed = false;
  private failure: unknown;

  public constructor(
    private readonly capacity: number,
    private readonly fetchPage: (page: Page, assertOpen: () => void) => Promise<Result>,
    private readonly isFatal: (error: unknown) => boolean
  ) {}

  public fill(pages: Iterable<Page>): void {
    for (const page of pages) {
      if (this.closed || this.pending.size >= this.capacity) break;
      if (this.pending.has(page.url)) continue;
      const result = this.fetchPage(page, () => this.assertOpen()).then(
        (value): FetchOutcome<Result> => ({ ok: true, value }),
        (error: unknown): FetchOutcome<Result> => {
          if (this.isFatal(error) && !this.closed) {
            this.failure = error;
            this.closed = true;
          }
          return { ok: false, error };
        }
      );
      this.pending.set(page.url, result);
    }
  }

  public async take(page: Page): Promise<Result> {
    const result = this.pending.get(page.url);
    if (!result) {
      this.assertOpen();
      throw new Error("Crawl page was not scheduled");
    }
    const outcome = await result;
    this.pending.delete(page.url);
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  /** Never release the owning lease while previously admitted work is active. */
  public async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.pending.values());
    this.pending.clear();
  }

  private assertOpen(): void {
    if (this.closed) throw this.failure ?? new Error("Crawl prefetch closed");
  }
}

export function crawlPagePrefetchCapacity(requestsPerMinute: number, maxResponseBytes: number): number {
  // Four seconds cover dispatch, HTTP and artifact transport on remote nodes.
  // Keep both the number of requests and retained response bodies bounded.
  return Math.max(1, Math.min(16, Math.ceil(requestsPerMinute / 60 * 4), Math.floor(32 * 1_048_576 / maxResponseBytes)));
}
