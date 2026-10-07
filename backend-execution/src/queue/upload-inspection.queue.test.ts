import assert from "node:assert/strict";
import test from "node:test";
import type { Queue } from "bullmq";
import { enqueueUploadInspection, UPLOAD_INSPECTION_JOB } from "./upload-inspection.queue.js";

test("a retained completed receipt cannot suppress a new upload inspection", async () => {
  const actions: string[] = [];
  const queue = {
    getJob: async () => ({
      getState: async () => "completed",
      remove: async () => { actions.push("remove"); }
    }),
    add: async (name: string, data: { uploadId: string }, options: { jobId: string }) => {
      actions.push(`add:${name}:${data.uploadId}:${options.jobId}`);
    }
  } as unknown as Queue<{ uploadId: string }>;

  await enqueueUploadInspection(queue, "upload-1");

  assert.deepEqual(actions, [
    "remove",
    `add:${UPLOAD_INSPECTION_JOB}:upload-1:upload-upload-1`
  ]);
});

test("an active upload is never duplicated and a failed one is retried", async () => {
  for (const state of ["active", "failed"] as const) {
    const actions: string[] = [];
    const queue = {
      getJob: async () => ({
        getState: async () => state,
        retry: async () => { actions.push("retry"); }
      }),
      add: async () => { actions.push("add"); }
    } as unknown as Queue<{ uploadId: string }>;

    await enqueueUploadInspection(queue, "upload-2");
    assert.deepEqual(actions, state === "failed" ? ["retry"] : []);
  }
});
