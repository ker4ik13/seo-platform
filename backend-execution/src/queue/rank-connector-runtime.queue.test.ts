import assert from "node:assert/strict";
import test from "node:test";
import type { Queue } from "bullmq";
import {
  enqueueRankConnectorRuntime,
  RANK_CONNECTOR_RUNTIME_JOB,
  type RankConnectorRuntimeJobData
} from "./rank-connector-runtime.queue.js";

test("queues only one removable opaque tick for a fixed runtime lane", async () => {
  const additions: unknown[][] = [];
  const queue = {
    getJob: async () => undefined,
    add: async (...args: unknown[]) => {
      additions.push(args);
      return undefined;
    }
  } as unknown as Queue<RankConnectorRuntimeJobData>;

  await enqueueRankConnectorRuntime(queue, 123);

  assert.equal(additions.length, 1);
  const addition = additions[0];
  assert.ok(addition);
  assert.equal(addition[0], RANK_CONNECTOR_RUNTIME_JOB);
  assert.deepEqual(addition[1], {
    schemaVersion: "rank-connector-runtime@1"
  });
  assert.equal(
    (addition[2] as { jobId?: string }).jobId,
    "rank-connector-runtime-123"
  );
  assert.equal(
    (addition[2] as { removeOnComplete?: boolean }).removeOnComplete,
    true
  );
  assert.equal(
    (addition[2] as { removeOnFail?: boolean }).removeOnFail,
    true
  );
  assert.doesNotMatch(JSON.stringify(addition[1]), /workspace|api|key/iu);
});

test("deduplicates a live lane and retries its failed tick", async () => {
  let added = 0;
  let retried = 0;
  const activeQueue = {
    getJob: async () => ({
      getState: async () => "active"
    }),
    add: async () => {
      added += 1;
      return undefined;
    }
  } as unknown as Queue<RankConnectorRuntimeJobData>;
  const failedQueue = {
    getJob: async () => ({
      getState: async () => "failed",
      retry: async () => {
        retried += 1;
      }
    }),
    add: async () => {
      added += 1;
      return undefined;
    }
  } as unknown as Queue<RankConnectorRuntimeJobData>;

  await enqueueRankConnectorRuntime(activeQueue, 123);
  await enqueueRankConnectorRuntime(failedQueue, 124);
  assert.equal(added, 0);
  assert.equal(retried, 1);
});
