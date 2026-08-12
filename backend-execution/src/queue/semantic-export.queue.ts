import type { Queue } from "bullmq";

export const SEMANTIC_EXPORT_QUEUE = "exports";
export const SEMANTIC_EXPORT_JOB = "semantic.export";

export interface SemanticExportJobData {
  readonly exportId: string;
}

export async function enqueueSemanticExport(
  queue: Queue<SemanticExportJobData>,
  exportId: string
): Promise<void> {
  const jobId = `semantic-export-${exportId}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state !== "completed" && state !== "failed") return;
    await existing.remove();
  }
  await queue.add(
    SEMANTIC_EXPORT_JOB,
    { exportId },
    {
      jobId,
      removeOnComplete: 500,
      removeOnFail: 1_000,
      attempts: 1
    }
  );
}
