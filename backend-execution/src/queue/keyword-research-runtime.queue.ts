import type { Queue } from "bullmq";

export const KEYWORD_RESEARCH_RUNTIME_QUEUE = "keyword-research-runtime";
export const KEYWORD_RESEARCH_RUNTIME_JOB = "keyword.research.runtime";

export interface KeywordResearchRuntimeJobData {
  readonly schemaVersion: "keyword-research-runtime@1";
  readonly tick: number;
}

export async function enqueueKeywordResearchRuntime(
  queue: Queue<KeywordResearchRuntimeJobData>,
  tick: number,
  lane = tick
): Promise<void> {
  if (
    !Number.isSafeInteger(tick) ||
    tick < 0 ||
    !Number.isSafeInteger(lane) ||
    lane < 0
  ) {
    throw new TypeError("Invalid keyword research runtime tick or lane");
  }
  const jobId = `keyword-research-runtime-${lane}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "failed") await existing.retry();
    return;
  }
  await queue.add(
    KEYWORD_RESEARCH_RUNTIME_JOB,
    { schemaVersion: "keyword-research-runtime@1", tick },
    {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: true
    }
  );
}
