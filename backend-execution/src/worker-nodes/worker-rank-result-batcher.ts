import type { RemoteRankPollResultV1 } from "@seo-platform/contracts";
import {
  WorkerAuthenticationError,
  WorkerRouteNotFoundError,
  type WorkerHttpClient
} from "./worker-http-client.js";

const MAX_ENTRIES = 8;
const MAX_BATCH_BYTES = 512 * 1024;
const MAX_IN_FLIGHT = 8;
const FLUSH_DELAY_MS = 100;

interface PendingResult {
  readonly value: RemoteRankPollResultV1;
  readonly bytes: number;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/** Batches completed provider calls without holding a task's fenced receipt. */
export class WorkerRankResultBatcher {
  private readonly pending: PendingResult[] = [];
  private inFlight = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(private readonly client: Pick<WorkerHttpClient, "post">) {}

  public complete(value: RemoteRankPollResultV1): Promise<void> {
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > MAX_BATCH_BYTES) return this.completeSingle(value);
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ value, bytes, resolve, reject });
      if (this.pending.length >= MAX_ENTRIES) this.pump(true);
      else if (!this.timer) this.timer = setTimeout(() => this.pump(true), FLUSH_DELAY_MS);
    });
  }

  private pump(flushPartial: boolean): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    while (this.inFlight < MAX_IN_FLIGHT && this.pending.length > 0 &&
      (flushPartial || this.pending.length >= MAX_ENTRIES)) {
      const group: PendingResult[] = [];
      let bytes = 64;
      while (group.length < MAX_ENTRIES && this.pending.length > 0 &&
        bytes + this.pending[0]!.bytes < MAX_BATCH_BYTES) {
        const item = this.pending.shift()!;
        group.push(item);
        bytes += item.bytes;
      }
      if (group.length === 0) break;
      this.inFlight++;
      void this.send(group).catch((error: unknown) => {
        group.forEach((item) => item.reject(error));
      }).finally(() => {
        this.inFlight--;
        this.pump(true);
      });
    }
  }

  private async send(group: readonly PendingResult[]): Promise<void> {
    let remaining = [...group];
    for (let attempt = 0; attempt < 3 && remaining.length > 0; attempt++) {
      try {
        const response = await this.client.post("rank/complete-batch", {
          schemaVersion: "worker-rank-poll-result-batch@1",
          entries: remaining.map((item) => item.value)
        }, 64 * 1024, 20_000);
        if (!Array.isArray(response) || response.length !== remaining.length ||
          response.some((status) => typeof status !== "boolean")) {
          throw new TypeError("Invalid worker rank batch acknowledgement");
        }
        const retry: PendingResult[] = [];
        for (let index = 0; index < remaining.length; index++) {
          const item = remaining[index]!;
          if (response[index]) item.resolve();
          else retry.push(item);
        }
        remaining = retry;
      } catch (error) {
        if (error instanceof WorkerRouteNotFoundError) {
          await Promise.all(remaining.map(async (item) => {
            try { await this.completeSingle(item.value); item.resolve(); }
            catch (failure) { item.reject(failure); }
          }));
          return;
        }
        if (error instanceof WorkerAuthenticationError) {
          remaining.forEach((item) => item.reject(error));
          return;
        }
        if (attempt === 2) {
          remaining.forEach((item) => item.reject(error));
          return;
        }
      }
      if (remaining.length > 0 && attempt < 2) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
    for (const item of remaining) item.reject(new Error("Worker rank result was not acknowledged"));
  }

  private async completeSingle(value: RemoteRankPollResultV1): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await this.client.post("rank/complete", value, 64 * 1024, 10_000); return; }
      catch (error) {
        if (error instanceof WorkerAuthenticationError || attempt === 2) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }
}
