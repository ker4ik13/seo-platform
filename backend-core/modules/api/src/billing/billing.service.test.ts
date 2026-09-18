import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { BillingService } from "./billing.service.js";
import { spendablePrepaidMinor } from "./billing-balance-availability.js";

test("financial refunds cannot bypass the administrator decision", async () => {
  const service = new BillingService({} as never, {} as never, {} as never, { isEnabled: () => true } as never, {} as never, {} as never);
  await assert.rejects(() => service.createRefund("workspace", "payment", "actor", "request-key", { amountMinor: 2000, reason: "Unused balance" }, {} as never), (error) => error instanceof DomainError && error.code === "FORBIDDEN");
});

test("legacy pending top-up refunds remain unavailable across the whole workspace", async () => {
  const queries: unknown[] = [];
  const transaction = { billingRefund: { aggregate: async (query: unknown) => { queries.push(query); return { _sum: { amountMinor: 9000n } }; } } };
  assert.equal(await spendablePrepaidMinor(transaction as never, "workspace", 10000n), 1000n);
  assert.deepEqual(queries[0], { where: { workspaceId: "workspace", refundRequestId: null, status: { in: ["CREATING", "PENDING", "FAILED_RETRYABLE"] }, payment: { order: { kind: "TOP_UP" } } }, _sum: { amountMinor: true } });
  assert.equal(await spendablePrepaidMinor(transaction as never, "workspace", 8000n), 0n);
});

test("does not request recurring YooKassa rights unless the shop enabled them", async () => {
  const service = new BillingService(
    {} as never,
    {} as never,
    {} as never,
    { isEnabled: () => true } as never,
    {} as never,
    { billing: { yookassa: { recurringEnabled: false } } } as never
  );
  await assert.rejects(
    () => service.createTopUp(
      "workspace",
      "actor",
      "request-key",
      {
        provider: "YOOKASSA",
        amountMinor: 10_000,
        buyerType: "INDIVIDUAL",
        deliveryEmail: "owner@example.test",
        savePaymentMethod: true,
        termsAccepted: true,
        termsVersion: "2026-09-18"
      },
      {} as never
    ),
    (error) => error instanceof DomainError &&
      error.code === "FEATURE_NOT_AVAILABLE"
  );
});
