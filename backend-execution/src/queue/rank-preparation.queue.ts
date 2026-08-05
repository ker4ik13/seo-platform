import type { Queue } from "bullmq";

export const RANK_PREPARATION_QUEUE = "rank-preparation";
export const RANK_PREPARATION_JOB = "rank.manifest.prepare";

export interface RankPreparationJobData {
  readonly jobId: string;
}

export async function enqueueRankPreparation(
  queue: Queue<RankPreparationJobData>,
  jobId: string
): Promise<void> {
  const queueJobId = `rank-preparation-${jobId}`;
  const existing = await queue.getJob(queueJobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "failed") {
      await existing.retry();
      return;
    }
    if (state !== "completed") return;
    await existing.remove();
  }
  await queue.add(
    RANK_PREPARATION_JOB,
    { jobId },
    {
      jobId: queueJobId,
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 5_000,
        jitter: 0.5
      },
      removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 10_000 }
    }
  );
}
