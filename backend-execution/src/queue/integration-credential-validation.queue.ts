import type { Queue } from "bullmq";

export const INTEGRATION_CREDENTIAL_VALIDATION_QUEUE =
  "integration-credential-validation";
export const INTEGRATION_CREDENTIAL_VALIDATION_JOB =
  "integration.credential.validate";
export const INTEGRATION_CREDENTIAL_VALIDATION_MAX_ATTEMPTS = 3;

export interface IntegrationCredentialValidationJobData {
  readonly jobId: string;
}

export async function enqueueIntegrationCredentialValidation(
  queue: Queue<IntegrationCredentialValidationJobData>,
  validationJobId: string
): Promise<void> {
  const queueJobId = `integration-credential-validation-${validationJobId}`;
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
    INTEGRATION_CREDENTIAL_VALIDATION_JOB,
    { jobId: validationJobId },
    {
      jobId: queueJobId,
      attempts: INTEGRATION_CREDENTIAL_VALIDATION_MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 10_000 }
    }
  );
}
