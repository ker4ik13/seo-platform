import assert from "node:assert/strict";
import test from "node:test";
import { shouldRefreshSemanticOperationMetrics } from "./semantic-live-operation-metrics.ts";

test("refreshes keyword metrics when the first observed operation state is already terminal", () => {
  assert.equal(
    shouldRefreshSemanticOperationMetrics("", "completed-ai-answer-job", false),
    true
  );
});

test("does not refresh the same operation state twice", () => {
  assert.equal(
    shouldRefreshSemanticOperationMetrics(
      "completed-ai-answer-job",
      "completed-ai-answer-job",
      false
    ),
    false
  );
});

test("waits for an in-flight keyword metrics refresh", () => {
  assert.equal(
    shouldRefreshSemanticOperationMetrics(
      "running-ai-answer-job",
      "completed-ai-answer-job",
      true
    ),
    false
  );
});
