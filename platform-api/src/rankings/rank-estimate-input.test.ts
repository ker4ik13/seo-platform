import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { createRankEstimateInput } from "./rank-estimate-input.js";

const contextId = "01900000-0000-7000-8000-000000000101";
const credentialId = "01900000-0000-7000-8000-000000000102";

test("parses the one-context rank estimate command with an explicit provider", () => {
  assert.deepEqual(
    createRankEstimateInput({
      trackingContextId: contextId.toUpperCase(),
      provider: "XMLSTOCK",
      credentialId: credentialId.toUpperCase()
    }),
    {
      trackingContextId: contextId,
      provider: "XMLSTOCK",
      credentialId
    }
  );
});

test("rejects unknown, missing and malformed estimate fields", () => {
  for (const value of [
    {},
    { trackingContextId: "not-a-uuid" },
    { trackingContextId: contextId, provider: "UNKNOWN" },
    { trackingContextId: contextId, credentialId: "not-a-uuid" },
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
