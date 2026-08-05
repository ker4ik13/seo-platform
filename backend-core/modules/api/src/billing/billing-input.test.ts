import assert from "node:assert/strict";
import test from "node:test";
import {
  billingCheckoutInput,
  billingRefundInput,
  billingTopUpInput,
  yookassaWebhookInput
} from "./billing-input.js";
import { DomainError } from "../common/domain-error.js";

const consent = {
  buyerType: "INDIVIDUAL",
  deliveryEmail: " Owner@Example.Test ",
  savePaymentMethod: false,
  termsAccepted: true,
  termsVersion: "terms-2026-07-01"
};

test("normalizes a paid plan checkout without accepting card data", () => {
  assert.deepEqual(
    billingCheckoutInput({
      ...consent,
      planCode: "team",
      period: "ANNUAL"
    }),
    {
      planCode: "TEAM",
      period: "ANNUAL",
      buyerType: "INDIVIDUAL",
      deliveryEmail: "owner@example.test",
      savePaymentMethod: false,
      termsAccepted: true,
      termsVersion: "terms-2026-07-01"
    }
  );
});

test("requires explicit consent and exact business taxpayer numbers", () => {
  assert.throws(
    () =>
      billingCheckoutInput({
        ...consent,
        planCode: "SOLO",
        period: "MONTHLY",
        termsAccepted: false
      }),
    fieldError("termsAccepted", "CONSENT_REQUIRED")
  );
  assert.throws(
    () =>
      billingCheckoutInput({
        ...consent,
        buyerType: "LEGAL_ENTITY",
        buyerName: "Example LLC",
        buyerInn: "123456789012",
        planCode: "TEAM",
        period: "MONTHLY"
      }),
    fieldError("buyerInn", "INVALID_BUYER_INN")
  );
});

test("enforces bounded integer amounts for top-ups and refunds", () => {
  assert.equal(
    billingTopUpInput({ ...consent, amountMinor: 10_000 }).amountMinor,
    10_000
  );
  assert.throws(
    () => billingTopUpInput({ ...consent, amountMinor: 9_999 }),
    fieldError("amountMinor", "INVALID_AMOUNT")
  );
  assert.deepEqual(billingRefundInput({ amountMinor: 100, reason: "Test" }), {
    amountMinor: 100,
    reason: "Test"
  });
  assert.throws(
    () => billingRefundInput({ amountMinor: 99, reason: "Test" }),
    fieldError("amountMinor", "INVALID_AMOUNT")
  );
});

test("derives a stable webhook identity without retaining PII", () => {
  const first = yookassaWebhookInput({
    type: "notification",
    event: "payment.succeeded",
    object: {
      id: "2f45f8d0-000f-5000-8000-1c3a1f1c9e10",
      status: "succeeded",
      metadata: { order_id: "private-order" }
    }
  });
  const replay = yookassaWebhookInput({
    object: {
      metadata: { order_id: "private-order" },
      status: "succeeded",
      id: "2f45f8d0-000f-5000-8000-1c3a1f1c9e10"
    },
    event: "payment.succeeded",
    type: "notification"
  });

  assert.equal(first.objectType, "payment");
  assert.equal(first.fingerprint, replay.fingerprint);
  assert.deepEqual(first.payloadHash, replay.payloadHash);
  assert.throws(
    () =>
      yookassaWebhookInput({
        type: "notification",
        event: "payment.unknown",
        object: { id: "valid-provider-id", status: "pending" }
      }),
    fieldError("event", "INVALID_WEBHOOK_EVENT")
  );
});

function fieldError(path: string, code: string): (error: unknown) => boolean {
  return (error) =>
    error instanceof DomainError &&
    error.fieldErrors?.[0]?.path === path &&
    error.fieldErrors[0].code === code;
}
