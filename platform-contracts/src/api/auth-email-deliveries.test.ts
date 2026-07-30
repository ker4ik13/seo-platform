import assert from "node:assert/strict";
import test from "node:test";
import {
  internalAuthEmailCompletion,
  internalAuthEmailCompletionReceipt
} from "./auth-email-deliveries.js";

const EVENT_ID = "01900000-0000-7000-8000-000000000101";

test("accepts exact delivered and bounced auth-email completion outcomes", () => {
  for (const outcome of ["DELIVERED", "BOUNCED"] as const) {
    assert.deepEqual(
      internalAuthEmailCompletion({
        schemaVersion: "auth-email-completion@1",
        eventId: EVENT_ID,
        outcome
      }),
      {
        schemaVersion: "auth-email-completion@1",
        eventId: EVENT_ID,
        outcome
      }
    );
    assert.deepEqual(
      internalAuthEmailCompletionReceipt({
        schemaVersion: "auth-email-completion-receipt@1",
        eventId: EVENT_ID,
        outcome
      }),
      {
        schemaVersion: "auth-email-completion-receipt@1",
        eventId: EVENT_ID,
        outcome
      }
    );
  }
});

test("rejects unknown outcomes and extra completion fields", () => {
  assert.throws(
    () =>
      internalAuthEmailCompletion({
        schemaVersion: "auth-email-completion@1",
        eventId: EVENT_ID,
        outcome: "FAILED"
      }),
    TypeError
  );
  assert.throws(
    () =>
      internalAuthEmailCompletion({
        schemaVersion: "auth-email-completion@1",
        eventId: EVENT_ID,
        outcome: "BOUNCED",
        providerResponse: "secret"
      }),
    TypeError
  );
});
