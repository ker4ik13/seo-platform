import type { Queue } from "bullmq";

export const KEYWORD_RESEARCH_RUNTIME_JOB = "keyword.research.runtime";

export interface KeywordResearchRuntimeJobData {
  readonly schemaVersion: "keyword-research-runtime@1";
  readonly tick: number;
}

export async function enqueueKeywordResearchRuntime(
  queue: Queue<KeywordResearchRuntimeJobData>,
  tick: number
): Promise<void> {
  const jobId = `keyword-research-runtime-${tick}`;
  if (await queue.getJob(jobId)) return;
  await queue.add(
    KEYWORD_RESEARCH_RUNTIME_JOB,
    { schemaVersion: "keyword-research-runtime@1", tick },
    {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 3_600, count: 5_000 },
      removeOnFail: { age: 86_400, count: 5_000 }
    }
  );
}
