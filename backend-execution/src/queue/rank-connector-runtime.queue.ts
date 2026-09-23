import type { Queue } from "bullmq";
export const RANK_CONNECTOR_RUNTIME_QUEUE = "rank-connector-runtime";
export const RANK_CONNECTOR_RUNTIME_JOB =
  "rank.connector.runtime";

export interface RankConnectorRuntimeJobData {
  readonly schemaVersion: "rank-connector-runtime@1";
}

export async function enqueueRankConnectorRuntime(
  queue: Queue<RankConnectorRuntimeJobData>,
  lane: number
): Promise<void> {
  if (!Number.isSafeInteger(lane) || lane < 0) {
    throw new TypeError("Invalid rank connector dispatch lane");
  }
  const jobId = `rank-connector-runtime-${lane}`;
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
      removeOnComplete: true,
      removeOnFail: true
    }
  );
}
