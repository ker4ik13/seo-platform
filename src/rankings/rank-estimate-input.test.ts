import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { createRankEstimateInput } from "./rank-estimate-input.js";

const contextId = "01900000-0000-7000-8000-000000000101";

test("parses the one-context rank estimate command", () => {
  assert.deepEqual(
    createRankEstimateInput({
      trackingContextId: contextId.toUpperCase()
    }),
    { trackingContextId: contextId }
  );
});

test("rejects unknown, missing and malformed estimate fields", () => {
  for (const value of [
    {},
    { trackingContextId: "not-a-uuid" },
    { trackingContextId: contextId, provider: "ARSENKIN" },
    [contextId]
  ]) {
    assert.throws(
      () => createRankEstimateInput(value),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === "VALIDATION_FAILED"
    );
  }
});
