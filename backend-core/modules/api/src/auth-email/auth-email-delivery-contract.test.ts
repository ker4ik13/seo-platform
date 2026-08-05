import assert from "node:assert/strict";
import test from "node:test";
import {
  internalAuthEmailCompletion,
  internalAuthEmailCompletionReceipt,
  internalAuthEmailMaterialDecision
} from "@seo-platform/contracts";

const EVENT_ID = "01900000-0000-7000-8000-000000000101";

test("strictly parses READY and SKIPPED material decisions", () => {
  const ready = {
    schemaVersion: "auth-email-material-decision@1",
    decision: "READY",
    eventId: EVENT_ID,
    eventType: "identity.password-reset.requested.v1",
    recipient: "owner@example.test",
    locale: "ru",
    expiresAt: "2026-07-30T10:30:00.000Z",
    actionUrl:
      "https://app.example.test/app/reset-password#token=opaque.signature"
  } as const;
  assert.deepEqual(internalAuthEmailMaterialDecision(ready), ready);

  const skipped = {
    schemaVersion: "auth-email-material-decision@1",
    decision: "SKIPPED",
    eventId: EVENT_ID,
    reason: "NOT_DELIVERABLE"
  } as const;
  assert.deepEqual(internalAuthEmailMaterialDecision(skipped), skipped);
});

test("rejects extra material, token fields, query tokens and non-fragment action URLs", () => {
  const ready = {
    schemaVersion: "auth-email-material-decision@1",
    decision: "READY",
    eventId: EVENT_ID,
    eventType: "identity.email-verification.requested.v1",
    recipient: "owner@example.test",
    locale: "en",
    expiresAt: "2026-07-30T10:30:00.000Z",
    actionUrl:
      "https://app.example.test/app/verify-email#token=opaque.signature"
  } as const;
  for (const value of [
    { ...ready, token: "forbidden" },
    {
      ...ready,
      actionUrl:
        "https://app.example.test/app/verify-email?token=forbidden"
    },
    {
      ...ready,
      actionUrl: "https://app.example.test/app/verify-email"
    },
    { ...ready, eventType: "identity.user.created.v1" }
  ]) {
    assert.throws(() => internalAuthEmailMaterialDecision(value), TypeError);
  }
});

test("completion command and receipt are separate exact deterministic schemas", () => {
  const completion = {
    schemaVersion: "auth-email-completion@1",
    eventId: EVENT_ID,
    outcome: "DELIVERED"
  } as const;
  const receipt = {
    schemaVersion: "auth-email-completion-receipt@1",
    eventId: EVENT_ID,
    outcome: "DELIVERED"
  } as const;
  assert.deepEqual(internalAuthEmailCompletion(completion), completion);
  assert.deepEqual(internalAuthEmailCompletionReceipt(receipt), receipt);
  assert.throws(
    () => internalAuthEmailCompletion({ ...completion, applied: true }),
    TypeError
  );
  assert.throws(
    () => internalAuthEmailCompletionReceipt(completion),
    TypeError
  );
});
