import assert from "node:assert/strict";
import test from "node:test";
import { addBillingPeriod, subscriptionPaymentEnd, unusedSubscriptionValue } from "./subscription-value.js";

test("calendar subscriptions clamp month and leap-year ends", () => {
  assert.equal(addBillingPeriod(new Date("2027-01-31T10:20:30Z"), "MONTHLY").toISOString(), "2027-02-28T10:20:30.000Z");
  assert.equal(addBillingPeriod(new Date("2028-02-29T10:20:30Z"), "ANNUAL").toISOString(), "2029-02-28T10:20:30.000Z");
});
test("early renewal preserves all remaining days; switching converts unused value into extra days", () => {
  const at = new Date("2026-09-15T00:00:00Z");
  assert.equal(subscriptionPaymentEnd({ at, period: "MONTHLY", paidMinor: 10000n, previousEnd: new Date("2026-10-01T00:00:00Z"), samePlan: true, carriedMinor: 5000n }).toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(subscriptionPaymentEnd({ at, period: "MONTHLY", paidMinor: 20000n, samePlan: false, carriedMinor: 10000n }).toISOString(), "2026-10-30T00:00:00.000Z");
});
test("unused service value only decreases and never invents fractional money", () => {
  const start = new Date("2026-09-01T00:00:00Z"), end = new Date("2026-10-01T00:00:00Z");
  assert.equal(unusedSubscriptionValue(30000n, start, end, new Date("2026-09-16T00:00:00Z")), 15000n);
  assert.equal(unusedSubscriptionValue(30000n, start, end, end), 0n);
  assert.equal(unusedSubscriptionValue(1n, start, end, new Date(start.getTime() + 1)), 0n);
});
