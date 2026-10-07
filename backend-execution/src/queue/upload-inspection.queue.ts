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
    const state = await existing.getState();
    if (state === "failed") {
      await existing.retry();
    } else if (state === "completed") {
      // The upload may have returned to UPLOADED after the old worker exited.
      // A retained completed BullMQ receipt must not suppress a new scan.
      await existing.remove();
    } else {
      return;
    }
    if (state === "failed") return;
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
