import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { internalRankEstimateScopeInput } from "./rank-scope-input.js";

const input = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  trackingContextId: "01900000-0000-7000-8000-000000000004"
} as const;

test("accepts only the exact internal rank scope command", () => {
  assert.deepEqual(internalRankEstimateScopeInput(input), input);
  assert.throws(
    () =>
      internalRankEstimateScopeInput({
        ...input,
        provider: "ARSENKIN"
      }),
    BadRequestException
  );
  assert.throws(
    () => {
      const { actorId: _actorId, ...missingActor } = input;
      internalRankEstimateScopeInput(missingActor);
    },
    BadRequestException
  );
  assert.throws(
    () =>
      internalRankEstimateScopeInput({
        ...input,
        trackingContextId: "context-1"
      }),
    BadRequestException
  );
});
