import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { BillingService } from "./billing.service.js";

test("reserves pending top-up refunds across the whole workspace", async () => {
  const aggregateQueries: unknown[] = [];
  let aggregateCall = 0;
  let refundCreated = false;
  const transaction = {
    billingPayment: {
      findFirst: async () => ({
        id: "0198f2fb-4c00-7000-8000-000000000010",
        workspaceId: "0198f2fb-4c00-7000-8000-000000000011",
        status: "SUCCEEDED",
        externalId: "provider-payment-1",
        amountMinor: 10_000n,
        refundedAmountMinor: 0n,
        order: { kind: "TOP_UP" }
      })
    },
    billingRefund: {
      aggregate: async (query: unknown) => {
        aggregateQueries.push(query);
        aggregateCall += 1;
        return {
          _sum: { amountMinor: aggregateCall === 1 ? 0n : 9_000n }
        };
      },
      create: async () => {
        refundCreated = true;
        throw new Error("refund must not be created");
      }
    }
  };
  const prisma = {
    billingRefund: { findUnique: async () => null },
    $transaction: async (
      operation: (current: typeof transaction) => Promise<unknown>
    ) => operation(transaction)
  };
  const ledger = {
    balance: async () => ({
      prepaidMinor: 10_000n,
      includedCreditsMinor: 0n
    })
  };
  const yookassa = { isEnabled: () => true };
  const service = new BillingService(
    prisma as never,
    ledger as never,
    {} as never,
    yookassa as never,
    {} as never,
    {} as never
  );

  await assert.rejects(
    service.createRefund(
      "0198f2fb-4c00-7000-8000-000000000011",
      "0198f2fb-4c00-7000-8000-000000000010",
      "0198f2fb-4c00-7000-8000-000000000012",
      "refund-request-1",
      { amountMinor: 2_000, reason: "Unused balance" },
      {} as never
    ),
    (error) =>
      error instanceof DomainError &&
      error.code === "RESOURCE_STATE_CONFLICT" &&
      error.details?.refundableMinor === 1_000
  );
  assert.equal(refundCreated, false);
  assert.equal(aggregateQueries.length, 2);
  assert.deepEqual(aggregateQueries[1], {
    where: {
      workspaceId: "0198f2fb-4c00-7000-8000-000000000011",
      status: { in: ["CREATING", "PENDING", "FAILED_RETRYABLE"] },
      payment: { order: { kind: "TOP_UP" } }
    },
    _sum: { amountMinor: true }
  });
});
