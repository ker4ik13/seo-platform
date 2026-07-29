import assert from "node:assert/strict";
import test from "node:test";
import type { Queue } from "bullmq";
import {
  enqueueRankPreparation,
  RANK_PREPARATION_JOB,
  type RankPreparationJobData
} from "./rank-preparation.queue.js";

const jobId = "0190abcd-0000-7000-8000-000000000001";

test("queues only the authoritative PostgreSQL Job identifier", async () => {
  const additions: unknown[][] = [];
  const queue = {
    getJob: async () => undefined,
    add: async (...args: unknown[]) => {
      additions.push(args);
      return undefined;
    }
  } as unknown as Queue<RankPreparationJobData>;

  await enqueueRankPreparation(queue, jobId);

  assert.equal(additions.length, 1);
  const addition = additions[0];
  assert.ok(addition);
  assert.equal(addition[0], RANK_PREPARATION_JOB);
  assert.deepEqual(addition[1], { jobId });
  assert.deepEqual(Object.keys(addition[1] as object), ["jobId"]);
  const options = addition[2] as {
    readonly jobId?: string;
    readonly backoff?: Readonly<Record<string, unknown>>;
  };
  assert.equal(
    options.jobId,
    `rank-preparation-${jobId}`
  );
  assert.deepEqual(
    options.backoff,
    { type: "exponential", delay: 5_000, jitter: 0.5 }
  );
});

test("recovers failed and completed queue records without duplicating active work", async () => {
  let retries = 0;
  let removals = 0;
  let additions = 0;
  const failed = queueWithExisting("failed", {
    retry: () => {
      retries += 1;
    },
    add: () => {
      additions += 1;
    }
  });
  const completed = queueWithExisting("completed", {
    remove: () => {
      removals += 1;
    },
    add: () => {
      additions += 1;
    }
  });
  const active = queueWithExisting("active", {
    add: () => {
      additions += 1;
    }
  });

  await enqueueRankPreparation(failed, jobId);
  await enqueueRankPreparation(completed, jobId);
  await enqueueRankPreparation(active, jobId);

  assert.equal(retries, 1);
  assert.equal(removals, 1);
  assert.equal(additions, 1);
});

function queueWithExisting(
  state: string,
  hooks: {
    readonly retry?: () => void;
    readonly remove?: () => void;
    readonly add?: () => void;
  }
): Queue<RankPreparationJobData> {
  return {
    getJob: async () => ({
      getState: async () => state,
      retry: async () => {
        hooks.retry?.();
      },
      remove: async () => {
        hooks.remove?.();
      }
    }),
    add: async () => {
      hooks.add?.();
      return undefined;
    }
  } as unknown as Queue<RankPreparationJobData>;
}
