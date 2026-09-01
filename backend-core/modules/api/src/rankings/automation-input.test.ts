import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createAutomationInput,
  updateAutomationInput
} from "./automation-input.js";

const input = {
  name: "Отложенный съём",
  trackingContextId: "01900000-0000-7000-8000-000000000001",
  timezone: "Europe/Moscow",
  schedule: { cadence: "ONCE", runAt: "2100-09-05T08:30:00Z" },
  failureThreshold: 3,
  enabled: true
} as const;

test("normalizes a future one-time schedule and defaults it to BYOK-only", () => {
  assert.deepEqual(createAutomationInput(input), {
    ...input,
    schedule: {
      cadence: "ONCE",
      runAt: "2100-09-05T08:30:00.000Z"
    },
    maxPlatformChargeMicro: "0"
  });
});

test("accepts only a bounded integer platform charge cap", () => {
  assert.equal(
    updateAutomationInput({
      ...input,
      maxPlatformChargeMicro: "9223372036854775807"
    }).maxPlatformChargeMicro,
    "9223372036854775807"
  );
  for (const maxPlatformChargeMicro of [
    1,
    "01",
    "1.5",
    "9223372036854775808"
  ]) {
    assert.throws(
      () =>
        createAutomationInput({ ...input, maxPlatformChargeMicro }),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === "VALIDATION_FAILED"
    );
  }
});

test("rejects the retired per-schedule keyword cap", () => {
  assert.throws(
    () => createAutomationInput({ ...input, maxItems: 200 }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "VALIDATION_FAILED"
  );
});
