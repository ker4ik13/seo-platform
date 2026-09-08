import assert from "node:assert/strict";
import test from "node:test";
import { isPermanentFreeSubscription } from "./billing-subscription-period.ts";

test("recognizes the legacy permanent free tier without hiding real trial or paid dates", () => {
  assert.equal(isPermanentFreeSubscription({ planCode: "TRIAL", currentPeriodEnd: "9999-12-31T23:59:59.000Z" }), true);
  assert.equal(isPermanentFreeSubscription({ planCode: "TRIAL", currentPeriodEnd: "2026-10-01T00:00:00Z" }), false);
  assert.equal(isPermanentFreeSubscription({ planCode: "SOLO", currentPeriodEnd: "2026-10-01T00:00:00Z" }), false);
  assert.equal(isPermanentFreeSubscription(undefined), false);
});
