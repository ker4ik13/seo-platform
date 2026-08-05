import type { Queue } from "bullmq";

export const UPLOAD_INSPECTION_QUEUE = "upload-inspection";
export const UPLOAD_INSPECTION_JOB = "upload.inspect";

export interface UploadInspectionJobData {
  readonly uploadId: string;
}

export async function enqueueUploadInspection(
  queue: Queue<UploadInspectionJobData>,
  uploadId: string
): Promise<void> {
  const jobId = `upload-${uploadId}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    if ((await existing.getState()) === "failed") {
      await existing.retry();
    }
    return;
  }
  await queue.add(
    UPLOAD_INSPECTION_JOB,
    { uploadId },
    {
      jobId,
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 10_000 }
    }
  );
}
