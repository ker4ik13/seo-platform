import assert from "node:assert/strict";
import test from "node:test";
import {
  isDismissibleOperationStatus,
  operationDismissalPath
} from "./operation-dismissal.ts";

const projectId = "01900000-0000-7000-8000-000000000001";
const jobId = "01900000-0000-7000-8000-000000000002";

test("allows dismissal only for terminal error states", () => {
  for (const status of ["FAILED", "FAILED_FINAL", "ACTION_REQUIRED", "EXPIRED"]) {
    assert.equal(isDismissibleOperationStatus(status), true);
  }
  for (const status of ["RUNNING", "FAILED_RETRYABLE", "PARTIALLY_COMPLETED", "COMPLETED", "CANCELLED"]) {
    assert.equal(isDismissibleOperationStatus(status), false);
  }
});

test("builds only a canonical same-origin operation dismissal path", () => {
  assert.equal(
    operationDismissalPath(projectId, jobId),
    `/app/api/projects/${projectId}/operations/${jobId}`
  );
  assert.throws(() => operationDismissalPath("../other", jobId), TypeError);
});
