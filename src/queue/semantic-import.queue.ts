import type { Queue } from "bullmq";

export const SEMANTIC_IMPORT_QUEUE = "semantic-import";
export const SEMANTIC_IMPORT_PARSE_JOB = "semantic.import.parse";
export const SEMANTIC_IMPORT_VALIDATE_JOB = "semantic.import.validate";
export const SEMANTIC_IMPORT_PUBLISH_JOB = "semantic.import.publish";

export interface SemanticImportJobData {
  readonly importId: string;
}

export async function enqueueSemanticImport(
  queue: Queue<SemanticImportJobData>,
  importId: string
): Promise<void> {
  return enqueue(
    queue,
    SEMANTIC_IMPORT_PARSE_JOB,
    importId,
    `semantic-import-parse-${importId}`
  );
}

export async function enqueueSemanticImportValidation(
  queue: Queue<SemanticImportJobData>,
  importId: string,
  version: number
): Promise<void> {
  return enqueue(
    queue,
    SEMANTIC_IMPORT_VALIDATE_JOB,
    importId,
    `semantic-import-validate-${importId}-v${version}`
  );
}

export async function enqueueSemanticImportPublish(
  queue: Queue<SemanticImportJobData>,
  importId: string,
  version: number
): Promise<void> {
  return enqueue(
    queue,
    SEMANTIC_IMPORT_PUBLISH_JOB,
    importId,
    `semantic-import-publish-${importId}-v${version}`
  );
}

async function enqueue(
  queue: Queue<SemanticImportJobData>,
  jobName:
    | typeof SEMANTIC_IMPORT_PARSE_JOB
    | typeof SEMANTIC_IMPORT_VALIDATE_JOB
    | typeof SEMANTIC_IMPORT_PUBLISH_JOB,
  importId: string,
  jobId: string
): Promise<void> {
  const existing = await queue.getJob(jobId);
  if (existing) {
    if ((await existing.getState()) === "failed") {
      await existing.retry();
    }
    return;
  }
  await queue.add(
    jobName,
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
