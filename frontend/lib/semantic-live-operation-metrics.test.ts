import assert from "node:assert/strict";
import test from "node:test";
import {
  semanticMetricRefreshMinIntervalMs,
  semanticResearchImportSignature,
  shouldRefreshSemanticOperationMetrics,
  shouldRefreshSemanticResearchImport
} from "./semantic-live-operation-metrics.ts";

test("refreshes keyword metrics when the first observed operation state is already terminal", () => {
  assert.equal(
    shouldRefreshSemanticOperationMetrics("", "completed-ai-answer-job", false, {
      active: false, visible: true, now: 1_000, lastAttemptAt: 999
    }),
    true
  );
});

test("does not refresh the same operation state twice", () => {
  assert.equal(
    shouldRefreshSemanticOperationMetrics(
      "completed-ai-answer-job",
      "completed-ai-answer-job",
      false,
      { active: false, visible: true, now: 1_000, lastAttemptAt: 0 }
    ),
    false
  );
});

test("waits for an in-flight keyword metrics refresh", () => {
  assert.equal(
    shouldRefreshSemanticOperationMetrics(
      "running-ai-answer-job",
      "completed-ai-answer-job",
      true,
      { active: true, visible: true, now: 20_000, lastAttemptAt: 0 }
    ),
    false
  );
});

test("coalesces active progress into bounded metric reads and catches up on visibility", () => {
  const running = {
    active: true, visible: true, now: 20_000,
    lastAttemptAt: 20_000 - semanticMetricRefreshMinIntervalMs + 1
  };
  assert.equal(shouldRefreshSemanticOperationMetrics("old", "new", false, running), false);
  assert.equal(shouldRefreshSemanticOperationMetrics("old", "new", false, {
    ...running, now: running.now + 1
  }), true);
  assert.equal(shouldRefreshSemanticOperationMetrics("old", "new", false, {
    ...running, visible: false, now: running.now + semanticMetricRefreshMinIntervalMs
  }), false);
  assert.equal(shouldRefreshSemanticOperationMetrics("old", "terminal", false, {
    ...running, active: false
  }), true, "terminal results refresh without the active-operation interval");
});

test("detects a completed keyword research import independently of API order", () => {
  const completed = {
    id: "run-b",
    importedKeywords: 120,
    status: "COMPLETED",
    updatedAt: "2026-08-26T20:00:00.000Z",
    version: 7
  };
  const ignored = {
    id: "run-a",
    importedKeywords: 0,
    status: "READY_TO_IMPORT",
    updatedAt: "2026-08-26T19:00:00.000Z",
    version: 3
  };

  assert.equal(
    semanticResearchImportSignature([completed, ignored]),
    semanticResearchImportSignature([ignored, completed])
  );
  assert.equal(
    shouldRefreshSemanticResearchImport(
      semanticResearchImportSignature([ignored]),
      semanticResearchImportSignature([completed, ignored])
    ),
    true
  );
});

test("does not refresh semantics twice for the same research import", () => {
  const signature = semanticResearchImportSignature([{
    id: "run-a",
    importedKeywords: 25,
    status: "COMPLETED",
    updatedAt: "2026-08-26T20:00:00.000Z",
    version: 5
  }]);

  assert.equal(shouldRefreshSemanticResearchImport(signature, signature), false);
});
