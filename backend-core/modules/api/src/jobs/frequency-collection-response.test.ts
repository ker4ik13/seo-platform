import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  scopedFrequencyCollection,
  scopedFrequencyOperationScope
} from "./frequency-collection-response.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const jobId = "01900000-0000-7000-8000-000000000003";

test("accepts a public 50,000-keyword frequency summary and rejects overflow", () => {
  const summary = {
    id: jobId,
    workspaceId,
    projectId,
    provider: "ARSENKIN",
    status: "RUNNING",
    stage: "WAITING_PROVIDER",
    selectedKeywords: 50_000,
    completedKeywords: 49_999,
    failedKeywords: 1,
    types: ["BASE", "EXACT", "FIXED"],
    regionCode: "213",
    device: "ALL",
    version: 2,
    createdAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:01:00.000Z",
    startedAt: "2026-08-02T12:00:01.000Z"
  };

  assert.equal(
    scopedFrequencyCollection(summary, workspaceId, projectId, jobId)
      .selectedKeywords,
    50_000
  );
  assert.throws(
    () =>
      scopedFrequencyCollection(
        { ...summary, selectedKeywords: 300_001 },
        workspaceId,
        projectId,
        jobId
      ),
    invalidDependencyResponse
  );
});

test("accepts one ordered operation result page and rejects page overflow", () => {
  const items = Array.from({ length: 200 }, (_, sequence) => ({
    sequence,
    keywordId: keywordIdAt(sequence),
    status: "PENDING"
  }));

  assert.equal(
    scopedFrequencyOperationScope(
      {
        workspaceId,
        projectId,
        jobId,
        items,
        page: { hasNext: true, nextCursor: "199" }
      },
      workspaceId,
      projectId,
      jobId,
      200
    ).items.length,
    200
  );
  assert.throws(
    () =>
      scopedFrequencyOperationScope(
        {
          workspaceId,
          projectId,
          jobId,
          items: [
            ...items,
            {
              sequence: 200,
              keywordId: keywordIdAt(200),
              status: "PENDING"
            }
          ],
          page: { hasNext: false }
        },
        workspaceId,
        projectId,
        jobId,
        200
      ),
    invalidDependencyResponse
  );
});

test("accepts a frequency result page beyond the first 1,000 items", () => {
  const result = scopedFrequencyOperationScope(
    {
      workspaceId,
      projectId,
      jobId,
      items: [
        {
          sequence: 1_000,
          keywordId: keywordIdAt(1_000),
          status: "COMPLETED"
        }
      ],
      page: { hasNext: false }
    },
    workspaceId,
    projectId,
    jobId,
    200,
    "999"
  );

  assert.equal(result.items[0]?.sequence, 1_000);
});

function keywordIdAt(index: number): string {
  return `01900000-0000-7000-8000-${(index + 1)
    .toString(16)
    .padStart(12, "0")}`;
}

function invalidDependencyResponse(error: unknown): boolean {
  return (
    error instanceof DomainError &&
    error.statusCode === 502 &&
    error.code === "DEPENDENCY_UNAVAILABLE"
  );
}
