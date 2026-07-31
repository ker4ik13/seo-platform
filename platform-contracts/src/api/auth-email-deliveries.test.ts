import assert from "node:assert/strict";
import test from "node:test";
import {
  internalAuthEmailCompletion,
  internalAuthEmailCompletionReceipt,
  internalAuthEmailMaterialDecision
} from "./auth-email-deliveries.js";

const EVENT_ID = "01900000-0000-7000-8000-000000000101";
const OFFICIAL_RECEIPT_ID = "205ldfqqhc";
const RECEIPT_URL =
  `https://lknpd.nalog.ru/api/v1/receipt/220704837033/${OFFICIAL_RECEIPT_ID}/print`;

test("accepts an exact official NPD receipt delivery material", () => {
  assert.deepEqual(
    internalAuthEmailMaterialDecision({
      schemaVersion: "auth-email-material-decision@1",
      decision: "READY_RECEIPT",
      eventId: EVENT_ID,
      eventType: "billing.npd-receipt.delivery-requested.v1",
      recipient: "buyer@example.test",
      locale: "ru-RU",
      officialReceiptId: OFFICIAL_RECEIPT_ID,
      receiptUrl: RECEIPT_URL,
      grossAmountMinor: 12_500,
      currency: "RUB",
      serviceDescription: "Подписка Team на 1 месяц"
    }),
    {
      schemaVersion: "auth-email-material-decision@1",
      decision: "READY_RECEIPT",
      eventId: EVENT_ID,
      eventType: "billing.npd-receipt.delivery-requested.v1",
      recipient: "buyer@example.test",
      locale: "ru-RU",
      officialReceiptId: OFFICIAL_RECEIPT_ID,
      receiptUrl: RECEIPT_URL,
      grossAmountMinor: 12_500,
      currency: "RUB",
      serviceDescription: "Подписка Team на 1 месяц"
    }
  );
});

test("rejects a forged or mismatched NPD receipt URL", () => {
  for (const receiptUrl of [
    RECEIPT_URL.replace("lknpd.nalog.ru", "example.test"),
    `${RECEIPT_URL}?token=secret`,
    RECEIPT_URL.replace(OFFICIAL_RECEIPT_ID, "another-receipt")
  ]) {
    assert.throws(
      () =>
        internalAuthEmailMaterialDecision({
          schemaVersion: "auth-email-material-decision@1",
          decision: "READY_RECEIPT",
          eventId: EVENT_ID,
          eventType: "billing.npd-receipt.delivery-requested.v1",
          recipient: "buyer@example.test",
          locale: "ru-RU",
          officialReceiptId: OFFICIAL_RECEIPT_ID,
          receiptUrl,
          grossAmountMinor: 12_500,
          currency: "RUB",
          serviceDescription: "Подписка Team на 1 месяц"
        }),
      TypeError
    );
  }
});

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
