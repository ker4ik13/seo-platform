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

test("accepts a public 10,000-keyword frequency summary and rejects overflow", () => {
  const summary = {
    id: jobId,
    workspaceId,
    projectId,
    provider: "ARSENKIN",
    status: "RUNNING",
    stage: "WAITING_PROVIDER",
    selectedKeywords: 10_000,
    completedKeywords: 9_999,
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
    10_000
  );
  assert.throws(
    () =>
      scopedFrequencyCollection(
        { ...summary, selectedKeywords: 10_001 },
        workspaceId,
        projectId,
        jobId
      ),
    invalidDependencyResponse
  );
});

test("accepts one ordered 10,000-keyword operation scope and rejects overflow", () => {
  const items = Array.from({ length: 10_000 }, (_, sequence) => ({
    sequence,
    keywordId: keywordIdAt(sequence),
    status: "PENDING"
  }));

  assert.equal(
    scopedFrequencyOperationScope(
      { workspaceId, projectId, jobId, items },
      workspaceId,
      projectId,
      jobId
    ).items.length,
    10_000
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
              sequence: 10_000,
              keywordId: keywordIdAt(10_000),
              status: "PENDING"
            }
          ]
        },
        workspaceId,
        projectId,
        jobId
      ),
    invalidDependencyResponse
  );
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
