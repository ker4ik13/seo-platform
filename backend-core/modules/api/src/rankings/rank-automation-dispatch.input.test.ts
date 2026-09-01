import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { rankAutomationDispatchInput } from "./rank-automation-dispatch.input.js";

const input = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  automationId: "01900000-0000-7000-8000-000000000004",
  automationVersion: 2,
  runId: "01900000-0000-7000-8000-000000000005",
  idempotencyKey:
    "rank-automation-dispatch-01900000-0000-7000-8000-000000000005",
  scheduledFor: "2026-09-05T08:30:00.000Z",
  trackingContextId: "01900000-0000-7000-8000-000000000006",
  maxPlatformChargeMicro: "12500000"
} as const;

test("accepts an exact rank automation dispatch envelope", () => {
  assert.deepEqual(rankAutomationDispatchInput(input), input);
});

test("rejects over-specified, malformed and unbounded dispatch envelopes", () => {
  for (const value of [
    { ...input, secret: "must-not-cross-boundary" },
    { ...input, scheduledFor: "2026-09-05 08:30" },
    { ...input, maxItems: 500 },
    { ...input, maxPlatformChargeMicro: "01" },
    { ...input, maxPlatformChargeMicro: "9223372036854775808" }
  ]) {
    assert.throws(
      () => rankAutomationDispatchInput(value),
      BadRequestException
    );
  }
});
