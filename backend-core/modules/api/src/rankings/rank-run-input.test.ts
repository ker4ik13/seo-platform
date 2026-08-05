import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  assertEmptyRankJobCancelInput,
  createRankRunInput,
  requiredRankRunIdempotencyKey
} from "./rank-run-input.js";

const estimateId = "01900000-0000-7000-8000-000000000001";

test("parses the exact public rank run input", () => {
  assert.deepEqual(
    createRankRunInput({ estimateId: estimateId.toUpperCase() }),
    { estimateId }
  );
  assert.equal(
    requiredRankRunIdempotencyKey("rank-run-create-0001"),
    "rank-run-create-0001"
  );
});

test("rejects missing, malformed and additional rank run fields", () => {
  for (const value of [
    {},
    { estimateId: "not-a-uuid" },
    { estimateId, provider: "ARSENKIN" },
    { estimateId, workspaceId: estimateId },
    [estimateId],
    undefined
  ]) {
    assert.throws(() => createRankRunInput(value), validationFailure);
  }
});

test("keeps public rank run idempotency compatible with internal minimum", () => {
  for (const value of [
    undefined,
    "short-key",
    "123456789012345",
    " contains-spaces ",
    "x".repeat(181)
  ]) {
    assert.throws(
      () => requiredRankRunIdempotencyKey(value),
      validationFailure
    );
  }
});

test("accepts only an exact empty cancellation object", () => {
  assert.doesNotThrow(() => assertEmptyRankJobCancelInput({}));
  for (const value of [
    undefined,
    null,
    [],
    { jobId: estimateId },
    { reason: "stop" }
  ]) {
    assert.throws(
      () => assertEmptyRankJobCancelInput(value),
      validationFailure
    );
  }
});

function validationFailure(error: unknown): boolean {
  return (
    error instanceof DomainError &&
    error.statusCode === 422 &&
    error.code === "VALIDATION_FAILED"
  );
}
