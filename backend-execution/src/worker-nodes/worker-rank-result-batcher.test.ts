import assert from "node:assert/strict";
import test from "node:test";
import type { RemoteRankPollResultV1 } from "@seo-platform/contracts";
import { WorkerRouteNotFoundError, type WorkerHttpClient } from "./worker-http-client.js";
import { WorkerRankResultBatcher } from "./worker-rank-result-batcher.js";

function entry(index: number): RemoteRankPollResultV1 {
  return {
    schemaVersion: "worker-rank-poll-result@1",
    ticket: `ticket-${index}`,
    requestSnapshot: { index },
    outcome: { status: "PENDING", retryAfterSeconds: 1 }
  };
}

test("16 completed rank pages use two HTTPS calls with eight independent receipts each", async () => {
  const sizes: number[] = [];
  const client = {
    async post(route: string, body: { entries: readonly unknown[] }) {
      assert.equal(route, "rank/complete-batch");
      sizes.push(body.entries.length);
      return body.entries.map(() => true);
    }
  } as unknown as WorkerHttpClient;
  const batcher = new WorkerRankResultBatcher(client);
  await Promise.all(Array.from({ length: 16 }, (_, index) => batcher.complete(entry(index))));
  assert.deepEqual(sizes, [8, 8]);
});

test("only unacknowledged rank receipts are retried", async () => {
  const received: string[][] = [];
  const client = {
    async post(_route: string, body: { entries: readonly RemoteRankPollResultV1[] }) {
      received.push(body.entries.map((item) => item.ticket));
      return received.length === 1 ? [true, false] : [true];
    }
  } as unknown as WorkerHttpClient;
  const batcher = new WorkerRankResultBatcher(client);
  await Promise.all([batcher.complete(entry(1)), batcher.complete(entry(2))]);
  assert.deepEqual(received, [["ticket-1", "ticket-2"], ["ticket-2"]]);
});

test("a newer worker falls back to individual receipts on an older center", async () => {
  const routes: string[] = [];
  const client = {
    async post(route: string) {
      routes.push(route);
      if (route === "rank/complete-batch") throw new WorkerRouteNotFoundError();
      return { status: "POLL_WAIT" };
    }
  } as unknown as WorkerHttpClient;
  const batcher = new WorkerRankResultBatcher(client);
  await Promise.all([batcher.complete(entry(1)), batcher.complete(entry(2))]);
  assert.deepEqual(routes, ["rank/complete-batch", "rank/complete", "rank/complete"]);
});
