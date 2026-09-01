import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { scopedRankOperationScope } from "./rank-operation-response.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const jobId = "01900000-0000-7000-8000-000000000003";

test("accepts an exact paged XMLStock rank operation scope", () => {
  assert.deepEqual(
    scopedRankOperationScope(
      {
        workspaceId,
        projectId,
        jobId,
        items: [
          {
            sequence: 1,
            status: "FAILED_FINAL",
            pollAttempts: 50,
            errorCode: "PROVIDER_UNAVAILABLE"
          }
        ],
        page: { hasNext: false }
      },
      workspaceId,
      projectId,
      jobId,
      200,
      "0"
    ),
    {
      workspaceId,
      projectId,
      jobId,
      items: [
        {
          sequence: 1,
          status: "FAILED_FINAL",
          pollAttempts: 50,
          errorCode: "PROVIDER_UNAVAILABLE"
        }
      ],
      page: { hasNext: false }
    }
  );
});

test("rejects extensible, out-of-order or unbounded rank operation scopes", () => {
  for (const items of [
    [{ sequence: 1, status: "FAILED_FINAL", pollAttempts: 50 }],
    [{ sequence: 0, status: "FAILED_FINAL", pollAttempts: -1 }],
    [{ sequence: 0, status: "FAILED_FINAL", pollAttempts: 50, secret: "no" }]
  ]) {
    assert.throws(
      () =>
        scopedRankOperationScope(
          {
            workspaceId,
            projectId,
            jobId,
            items,
            page: { hasNext: false }
          },
          workspaceId,
          projectId,
          jobId,
          200
        ),
      DomainError
    );
  }
});
