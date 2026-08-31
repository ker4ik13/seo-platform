import assert from "node:assert/strict";
import test from "node:test";
import { BillingLedgerService, type BillingLedgerPostInput } from "./billing-ledger.service.js";

const occurredAt = new Date("2026-08-27T10:00:00.000Z");
const input: BillingLedgerPostInput = {
  type: "TOP_UP",
  businessReference: "top-up:payment-1",
  description: "Prepaid balance top-up",
  occurredAt,
  createdBy: "0198f2fb-4c00-7000-8000-000000000001",
  metadata: { orderId: "order-1", nested: { b: 2, a: 1 } },
  entries: [
    {
      workspaceId: "0198f2fb-4c00-7000-8000-000000000002",
      accountType: "CUSTOMER_PREPAID_LIABILITY",
      direction: "CREDIT",
      amountMinor: 10_000n
    },
    {
      accountType: "PAYMENT_CLEARING",
      direction: "DEBIT",
      amountMinor: 10_000n
    }
  ]
};

test("replays only an exactly matching posted ledger transaction", async () => {
  const service = new BillingLedgerService();
  const transaction = {
    billingLedgerTransaction: {
      findUnique: async () => ({
        id: "ledger-1",
        type: input.type,
        status: "POSTED",
        description: input.description,
        occurredAt,
        createdBy: input.createdBy,
        metadata: { nested: { a: 1, b: 2 }, orderId: "order-1" },
        reversalOfId: null,
        entries: [
          {
            direction: "DEBIT",
            amountMinor: 10_000n,
            currency: "RUB",
            account: { workspaceId: null, type: "PAYMENT_CLEARING" }
          },
          {
            direction: "CREDIT",
            amountMinor: 10_000n,
            currency: "RUB",
            account: {
              workspaceId: "0198f2fb-4c00-7000-8000-000000000002",
              type: "CUSTOMER_PREPAID_LIABILITY"
            }
          }
        ]
      })
    }
  };

  assert.equal(await service.post(transaction as never, input), "ledger-1");
});

test("rejects a reused business reference with different economic data", async () => {
  const service = new BillingLedgerService();
  const transaction = {
    billingLedgerTransaction: {
      findUnique: async () => ({
        id: "ledger-1",
        type: input.type,
        status: "POSTED",
        description: input.description,
        occurredAt,
        createdBy: input.createdBy,
        metadata: input.metadata,
        reversalOfId: null,
        entries: [
          {
            direction: "DEBIT",
            amountMinor: 9_999n,
            currency: "RUB",
            account: { workspaceId: null, type: "PAYMENT_CLEARING" }
          },
          {
            direction: "CREDIT",
            amountMinor: 9_999n,
            currency: "RUB",
            account: {
              workspaceId: "0198f2fb-4c00-7000-8000-000000000002",
              type: "CUSTOMER_PREPAID_LIABILITY"
            }
          }
        ]
      })
    }
  };

  await assert.rejects(
    service.post(transaction as never, input),
    /Billing ledger idempotency conflict/u
  );
});

test("rejects duplicate entries before writing a draft transaction", async () => {
  const service = new BillingLedgerService();
  let createCalled = false;
  const transaction = {
    billingLedgerTransaction: {
      findUnique: async () => null,
      create: async () => {
        createCalled = true;
      }
    }
  };
  const duplicate: BillingLedgerPostInput = {
    ...input,
    entries: [
      input.entries[0]!,
      input.entries[0]!,
      {
        accountType: "PAYMENT_CLEARING",
        direction: "DEBIT",
        amountMinor: 20_000n
      }
    ]
  };

  await assert.rejects(
    service.post(transaction as never, duplicate),
    /duplicate entry/u
  );
  assert.equal(createCalled, false);
});
