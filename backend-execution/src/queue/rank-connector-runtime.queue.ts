import type { Queue } from "bullmq";
export const RANK_CONNECTOR_RUNTIME_QUEUE = "rank-connector-runtime";
export const RANK_CONNECTOR_RUNTIME_JOB =
  "rank.connector.runtime";

export interface RankConnectorRuntimeJobData {
  readonly schemaVersion: "rank-connector-runtime@1";
}

export async function enqueueRankConnectorRuntime(
  queue: Queue<RankConnectorRuntimeJobData>,
  dispatchBucket: number
): Promise<void> {
  if (!Number.isSafeInteger(dispatchBucket) || dispatchBucket < 0) {
    throw new TypeError("Invalid rank connector dispatch bucket");
  }
  const jobId = `rank-connector-runtime-${dispatchBucket}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "failed") {
      await existing.retry();
    }
    return;
  }
  await queue.add(
    RANK_CONNECTOR_RUNTIME_JOB,
    { schemaVersion: "rank-connector-runtime@1" },
    {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 60 * 60, count: 1_000 },
      removeOnFail: { age: 24 * 60 * 60, count: 1_000 }
    }
  );
}
