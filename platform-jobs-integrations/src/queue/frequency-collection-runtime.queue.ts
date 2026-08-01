import type { Queue } from "bullmq";

export const FREQUENCY_COLLECTION_RUNTIME_JOB = "frequency.collection.runtime";

export interface FrequencyCollectionRuntimeJobData {
  readonly schemaVersion: "frequency-collection-runtime@1";
  readonly tick: number;
}

export async function enqueueFrequencyCollectionRuntime(
  queue: Queue<FrequencyCollectionRuntimeJobData>,
  tick: number
): Promise<void> {
  const jobId = `frequency-collection-runtime-${tick}`;
  if (await queue.getJob(jobId)) return;
  await queue.add(
    FREQUENCY_COLLECTION_RUNTIME_JOB,
    { schemaVersion: "frequency-collection-runtime@1", tick },
    {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 3_600, count: 5_000 },
      removeOnFail: { age: 86_400, count: 5_000 }
    }
  );
}
