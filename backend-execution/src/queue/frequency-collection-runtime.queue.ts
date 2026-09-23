import type { Queue } from "bullmq";

export const FREQUENCY_COLLECTION_RUNTIME_QUEUE =
  "frequency-collection-runtime";
export const FREQUENCY_COLLECTION_RUNTIME_JOB = "frequency.collection.runtime";

export interface FrequencyCollectionRuntimeJobData {
  readonly schemaVersion: "frequency-collection-runtime@1";
  readonly tick: number;
}

export async function enqueueFrequencyCollectionRuntime(
  queue: Queue<FrequencyCollectionRuntimeJobData>,
  tick: number,
  lane = tick
): Promise<void> {
  if (
    !Number.isSafeInteger(tick) ||
    tick < 0 ||
    !Number.isSafeInteger(lane) ||
    lane < 0
  ) {
    throw new TypeError("Invalid frequency runtime tick or lane");
  }
  const jobId = `frequency-collection-runtime-${lane}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "failed") await existing.retry();
    return;
  }
  await queue.add(
    FREQUENCY_COLLECTION_RUNTIME_JOB,
    { schemaVersion: "frequency-collection-runtime@1", tick },
    {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: true
    }
  );
}
