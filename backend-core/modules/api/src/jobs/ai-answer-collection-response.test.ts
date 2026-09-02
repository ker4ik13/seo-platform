import assert from "node:assert/strict";
import test from "node:test";
import {
  scopedAiAnswerCollection,
  scopedAiAnswerOperationScope
} from "./ai-answer-collection-response.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const jobId = "01900000-0000-7000-8000-000000000003";
const keywordId = "01900000-0000-7000-8000-000000000004";

test("preserves the exact AI competitor collection policy", () => {
  const summary = {
    id: jobId,
    workspaceId,
    projectId,
    provider: "ARSENKIN",
    purpose: "COMPETITOR_SERP",
    saveProjectPosition: false,
    status: "COMPLETED",
    stage: "completed",
    selectedKeywords: 2,
    completedKeywords: 2,
    failedKeywords: 0,
    searchEngine: "YANDEX",
    regionCode: "213",
    device: "DESKTOP",
    host: "example.com",
    version: 4,
    createdAt: "2026-08-19T12:00:00.000Z",
    updatedAt: "2026-08-19T12:01:00.000Z",
    finishedAt: "2026-08-19T12:01:00.000Z"
  } as const;

  const result = scopedAiAnswerCollection(
    summary,
    workspaceId,
    projectId,
    jobId
  );
  assert.equal(result.purpose, "COMPETITOR_SERP");
  assert.equal(result.saveProjectPosition, false);
  assert.throws(() => scopedAiAnswerCollection(
    { ...summary, saveProjectPosition: undefined },
    workspaceId,
    projectId,
    jobId
  ));
});

test("validates the exact Jobs-owned AI answer log page", () => {
  const result = scopedAiAnswerOperationScope(
    {
      workspaceId,
      projectId,
      jobId,
      items: [{
        sequence: 0,
        keywordId,
        status: "FAILED_FINAL",
        attempt: 8,
        providerSubmitted: true,
        errorCode: "AI_ANSWER_RESULT_REJECTED",
        updatedAt: "2026-08-19T12:00:00.000Z"
      }],
      page: { hasNext: false }
    },
    workspaceId,
    projectId,
    jobId,
    200
  );

  assert.equal(result.items[0]?.providerSubmitted, true);
  assert.equal(result.items[0]?.attempt, 8);
});
