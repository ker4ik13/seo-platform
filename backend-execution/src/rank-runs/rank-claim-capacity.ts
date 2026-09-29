/** Limits short database claims without holding a slot during provider I/O. */
export class RankClaimCapacity {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  public constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new TypeError("Rank claim capacity must be a positive integer");
    }
  }

  public async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      // Transfer the occupied slot to the oldest waiter atomically.
      next();
    } else {
      this.active -= 1;
    }
  }
}
