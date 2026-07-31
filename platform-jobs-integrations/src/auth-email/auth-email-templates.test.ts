import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_EMAIL_MATERIAL_DECISION_SCHEMA,
  transactionalEmailEventTypesV1,
  type InternalAuthEmailReadyReceiptDecisionV1,
  type InternalAuthEmailReadyMaterialDecisionV1
} from "@seo-platform/contracts";
import {
  authEmailMessageId,
  renderAuthEmail
} from "./auth-email-templates.js";

const eventId = "01900000-0000-7000-8000-000000000001";

test("renders localized verification, reset and invite messages with one stable Message-ID", () => {
  for (const [eventType, locale, expectedSubject] of [
    [
      transactionalEmailEventTypesV1.emailVerificationRequested,
      "ru-RU",
      "Подтвердите адрес электронной почты"
    ],
    [
      transactionalEmailEventTypesV1.passwordResetRequested,
      "en",
      "Reset your password"
    ],
    [
      transactionalEmailEventTypesV1.workspaceInviteRequested,
      "ru",
      "Приглашение в рабочую область"
    ]
  ] as const) {
    const actionUrl = "https://app.example.test/action#token=one_time~token";
    const message = renderAuthEmail(
      readyMaterial({ eventType, locale, actionUrl }),
      "mail.example.test"
    );

    assert.equal(message.messageId, `<auth-email-${eventId}@mail.example.test>`);
    assert.equal(message.to, "person@example.test");
    assert.equal(message.subject, expectedSubject);
    assert.ok(message.text.includes(actionUrl));
    assert.ok(message.text.includes("UTC"));
    assert.ok(message.html?.includes(`href="${actionUrl}"`));
  }
});

test("falls back to English copy while keeping the locale-independent Message-ID", () => {
  const material = readyMaterial({
    eventType: transactionalEmailEventTypesV1.passwordResetRequested,
    locale: "de"
  });
  const first = renderAuthEmail(material, "mail.example.test");
  const replay = renderAuthEmail(material, "mail.example.test");

  assert.equal(first.subject, "Reset your password");
  assert.equal(first.messageId, replay.messageId);
  assert.deepEqual(first, replay);
});

test("renders an official localized NPD receipt without treating it as an action token", () => {
  const material: InternalAuthEmailReadyReceiptDecisionV1 = {
    schemaVersion: AUTH_EMAIL_MATERIAL_DECISION_SCHEMA,
    decision: "READY_RECEIPT",
    eventId,
    eventType:
      transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested,
    recipient: "buyer@example.test",
    locale: "ru-RU",
    officialReceiptId: "205ldfqqhc",
    receiptUrl:
      "https://lknpd.nalog.ru/api/v1/receipt/220704837033/205ldfqqhc/print",
    grossAmountMinor: 12_500,
    currency: "RUB",
    serviceDescription: "Подписка Team на 1 месяц"
  };
  const message = renderAuthEmail(material, "mail.example.test");

  assert.equal(message.subject, "Ваш чек об оплате SEO Workspace");
  assert.match(message.text, /125/u);
  assert.match(message.text, /205ldfqqhc/u);
  assert.match(message.html ?? "", /lknpd\.nalog\.ru/u);
  assert.doesNotMatch(message.text, /#token=/u);
});

test("rejects unsafe action URLs and Message-ID inputs", () => {
  assert.throws(
    () =>
      renderAuthEmail(
        readyMaterial({
          eventType: transactionalEmailEventTypesV1.emailVerificationRequested,
          actionUrl: "https://user:password@app.example.test/#token=value"
        }),
        "mail.example.test"
      ),
    /Invalid auth email action URL/u
  );
  assert.throws(
    () => authEmailMessageId(`${eventId}\r\nBcc: victim@example.test`, "mail.example.test"),
    /Invalid auth email event ID/u
  );
  assert.throws(
    () => authEmailMessageId(eventId, "bad domain"),
    /Invalid auth email Message-ID domain/u
  );
  assert.throws(
    () =>
      authEmailMessageId(
        eventId,
        [
          "a".repeat(63),
          "b".repeat(63),
          "c".repeat(63),
          "d".repeat(14)
        ].join(".")
      ),
    /Invalid auth email Message-ID domain/u
  );
});

function readyMaterial(
  overrides: Pick<InternalAuthEmailReadyMaterialDecisionV1, "eventType"> &
    Partial<InternalAuthEmailReadyMaterialDecisionV1>
): InternalAuthEmailReadyMaterialDecisionV1 {
  const { eventType, ...rest } = overrides;
  return {
    schemaVersion: AUTH_EMAIL_MATERIAL_DECISION_SCHEMA,
    decision: "READY",
    eventId,
    eventType,
    recipient: "person@example.test",
    locale: "en",
    expiresAt: "2026-08-01T12:00:00.000Z",
    actionUrl: "https://app.example.test/action#token=one_time~token",
    ...rest
  };
}
