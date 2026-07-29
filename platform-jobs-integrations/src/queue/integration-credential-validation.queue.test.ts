import assert from "node:assert/strict";
import test from "node:test";
import type { Queue } from "bullmq";
import {
  enqueueIntegrationCredentialValidation,
  INTEGRATION_CREDENTIAL_VALIDATION_JOB,
  type IntegrationCredentialValidationJobData
} from "./integration-credential-validation.queue.js";

const validationJobId = "01900000-0000-7000-8000-000000000001";

test("queues only the database job identifier", async () => {
  const additions: unknown[][] = [];
  const queue = {
    getJob: async () => undefined,
    add: async (...args: unknown[]) => {
      additions.push(args);
      return undefined;
    }
  } as unknown as Queue<IntegrationCredentialValidationJobData>;

  await enqueueIntegrationCredentialValidation(queue, validationJobId);

  assert.equal(additions.length, 1);
  const addition = additions[0];
  assert.ok(addition);
  assert.equal(addition[0], INTEGRATION_CREDENTIAL_VALIDATION_JOB);
  assert.deepEqual(addition[1], { jobId: validationJobId });
  const options = addition[2] as { readonly jobId?: string };
  assert.equal(
    options.jobId,
    `integration-credential-validation-${validationJobId}`
  );
});

test("reconciles completed or failed queue records with a pending database job", async () => {
  let removed = 0;
  let retried = 0;
  let additions = 0;
  const completedQueue = {
    getJob: async () => ({
      getState: async () => "completed",
      remove: async () => {
        removed += 1;
      }
    }),
    add: async () => {
      additions += 1;
      return undefined;
    }
  } as unknown as Queue<IntegrationCredentialValidationJobData>;
  const failedQueue = {
    getJob: async () => ({
      getState: async () => "failed",
      retry: async () => {
        retried += 1;
      }
    }),
    add: async () => {
      additions += 1;
      return undefined;
    }
  } as unknown as Queue<IntegrationCredentialValidationJobData>;

  await enqueueIntegrationCredentialValidation(
    completedQueue,
    validationJobId
  );
  await enqueueIntegrationCredentialValidation(failedQueue, validationJobId);

  assert.equal(removed, 1);
  assert.equal(retried, 1);
  assert.equal(additions, 1);
});
