import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  renameWebPushDeviceInput,
  upsertWebPushSubscriptionInput
} from "./web-push-input.js";

const keyAgreement = createECDH("prime256v1");
keyAgreement.generateKeys();
const p256dh = keyAgreement.getPublicKey().toString("base64url");
const auth = Buffer.alloc(16, 7).toString("base64url");

test("parses and normalizes an exact browser subscription", () => {
  const result = upsertWebPushSubscriptionInput(validInput());

  assert.equal(result.label, "Рабочий Mac");
  assert.equal(result.intent, "ENABLE");
  assert.equal(result.applicationServerKeyVersion, 1);
  assert.equal(result.subscription.keys.p256dh, p256dh);
});

test("rejects browser authority fields and unknown nested fields", () => {
  assert.throws(
    () =>
      upsertWebPushSubscriptionInput({
        ...validInput(),
        userId: "01900000-0000-7000-8000-000000000001"
      }),
    DomainError
  );
  const input = validInput();
  assert.throws(
    () =>
      upsertWebPushSubscriptionInput({
        ...input,
        subscription: {
          ...input.subscription,
          userAgent: "trusted-by-browser"
        }
      }),
    DomainError
  );
});

test("rejects control and bidi characters in a device label", () => {
  for (const label of ["Line\nbreak", "Hidden\u202ename"]) {
    assert.throws(
      () => upsertWebPushSubscriptionInput(validInput({ label })),
      DomainError
    );
  }
  assert.throws(
    () => renameWebPushDeviceInput({ label: "Mac", status: "ACTIVE" }),
    DomainError
  );
});

test("rejects unsafe push endpoints before reaching the owner service", () => {
  for (const endpoint of [
    "http://push.example.test/subscription",
    "https://user:secret@push.example.test/subscription",
    "https://push.example.test:8443/subscription",
    "https://127.0.0.1/subscription",
    "https://[::1]/subscription",
    "https://push.example.test/subscription#secret"
  ]) {
    assert.throws(
      () =>
        upsertWebPushSubscriptionInput(
          validInput({ subscription: { endpoint } })
        ),
      DomainError,
      endpoint
    );
  }
});

test("validates canonical browser key material and the P-256 point", () => {
  assert.throws(
    () =>
      upsertWebPushSubscriptionInput(
        validInput({
          subscription: {
            keys: { p256dh: `${p256dh}=`, auth }
          }
        })
      ),
    DomainError
  );
  assert.throws(
    () =>
      upsertWebPushSubscriptionInput(
        validInput({
          subscription: {
            keys: {
              p256dh: Buffer.concat([
                Buffer.from([0x04]),
                Buffer.alloc(64)
              ]).toString("base64url"),
              auth
            }
          }
        })
      ),
    DomainError
  );
  assert.throws(
    () =>
      upsertWebPushSubscriptionInput(
        validInput({
          subscription: {
            keys: {
              p256dh,
              auth: Buffer.alloc(15).toString("base64url")
            }
          }
        })
      ),
    DomainError
  );
});

test("accepts null or future expiration and rejects stale values", () => {
  assert.equal(
    upsertWebPushSubscriptionInput(
      validInput({ subscription: { expirationTime: null } })
    ).subscription.expirationTime,
    null
  );
  assert.throws(
    () =>
      upsertWebPushSubscriptionInput(
        validInput({
          subscription: { expirationTime: Date.now() - 1 }
        })
      ),
    DomainError
  );
});

interface InputOverrides {
  readonly label?: string;
  readonly subscription?: {
    readonly endpoint?: string;
    readonly expirationTime?: number | null;
    readonly keys?: {
      readonly p256dh: string;
      readonly auth: string;
    };
  };
}

function validInput(overrides: InputOverrides = {}) {
  return {
    label: overrides.label ?? "  Рабочий Mac  ",
    intent: "ENABLE",
    applicationServerKeyVersion: 1,
    subscription: {
      endpoint:
        overrides.subscription?.endpoint ??
        "https://push.example.test/subscriptions/opaque",
      expirationTime:
        overrides.subscription?.expirationTime === undefined
          ? Date.now() + 60_000
          : overrides.subscription.expirationTime,
      keys: overrides.subscription?.keys ?? { p256dh, auth }
    }
  };
}
