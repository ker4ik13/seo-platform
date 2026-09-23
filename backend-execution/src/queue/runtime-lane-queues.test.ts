import assert from "node:assert/strict";
import test from "node:test";
import type { Queue } from "bullmq";
import {
  enqueueFrequencyCollectionRuntime,
  type FrequencyCollectionRuntimeJobData
} from "./frequency-collection-runtime.queue.js";
import {
  enqueueKeywordResearchRuntime,
  type KeywordResearchRuntimeJobData
} from "./keyword-research-runtime.queue.js";

test("frequency and research ticks reuse removable fixed lanes", async () => {
  const additions: unknown[][] = [];
  const queue = {
    getJob: async () => undefined,
    add: async (...args: unknown[]) => {
      additions.push(args);
      return undefined;
    }
  } as unknown as Queue<
    FrequencyCollectionRuntimeJobData | KeywordResearchRuntimeJobData
  >;

  await enqueueFrequencyCollectionRuntime(
    queue as Queue<FrequencyCollectionRuntimeJobData>,
    9_001,
    4
  );
  await enqueueKeywordResearchRuntime(
    queue as Queue<KeywordResearchRuntimeJobData>,
    9_002,
    0
  );

  assert.equal(additions.length, 2);
  assert.deepEqual(
    additions.map((addition) => ({
      jobId: (addition[2] as { jobId: string }).jobId,
      removeOnComplete: (addition[2] as { removeOnComplete: boolean })
        .removeOnComplete,
      removeOnFail: (addition[2] as { removeOnFail: boolean }).removeOnFail
    })),
    [
      {
        jobId: "frequency-collection-runtime-4",
        removeOnComplete: true,
        removeOnFail: true
      },
      {
        jobId: "keyword-research-runtime-0",
        removeOnComplete: true,
        removeOnFail: true
      }
    ]
  );
});
