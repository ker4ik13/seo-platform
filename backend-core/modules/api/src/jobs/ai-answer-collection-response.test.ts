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

test("accepts only a bounded Arsenkin task percentage on the active collection", () => {
  const summary = {
    id: jobId,
    workspaceId,
    projectId,
    provider: "ARSENKIN",
    status: "RETRY_SCHEDULED",
    stage: "provider_poll",
    selectedKeywords: 110,
    completedKeywords: 0,
    failedKeywords: 0,
    providerProgressPercent: 87,
    searchEngine: "YANDEX",
    regionCode: "213",
    device: "DESKTOP",
    host: "example.com",
    version: 3,
    createdAt: "2026-10-07T07:13:19.000Z",
    updatedAt: "2026-10-07T07:36:54.000Z"
  } as const;
  assert.equal(scopedAiAnswerCollection(summary, workspaceId, projectId).providerProgressPercent, 87);
  assert.throws(() => scopedAiAnswerCollection(
    { ...summary, providerProgressPercent: 101 }, workspaceId, projectId
  ));
  assert.throws(() => scopedAiAnswerCollection(
    { ...summary, status: "COMPLETED" }, workspaceId, projectId
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
