import type { Queue } from "bullmq";

export const SEMANTIC_IMPORT_QUEUE = "semantic-import";
export const SEMANTIC_IMPORT_PARSE_JOB = "semantic.import.parse";

export interface SemanticImportJobData {
  readonly importId: string;
}

export async function enqueueSemanticImport(
  queue: Queue<SemanticImportJobData>,
  importId: string
): Promise<void> {
  const jobId = `semantic-import-${importId}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    if ((await existing.getState()) === "failed") {
      await existing.retry();
    }
    return;
  }
  await queue.add(
    SEMANTIC_IMPORT_PARSE_JOB,
    { importId },
    {
      jobId,
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 10_000 }
    }
  );
}
