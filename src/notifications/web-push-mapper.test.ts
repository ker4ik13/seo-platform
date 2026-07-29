import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  webPushDeviceSummary,
  webPushRevokeResult,
  webPushSubscriptionsState
} from "./web-push-mapper.js";

const installationId = "01900000-0000-7000-8000-000000000001";
const keyAgreement = createECDH("prime256v1");
keyAgreement.generateKeys();
const applicationServerKey = keyAgreement
  .getPublicKey()
  .toString("base64url");

test("maps only the safe Web Push registration and device projection", () => {
  const state = webPushSubscriptionsState({
    registration: {
      status: "AVAILABLE",
      applicationServerKey,
      applicationServerKeyVersion: 2,
      maxActiveDevices: 20,
      deliveryAvailable: false,
      testDeliveryAvailable: false
    },
    devices: [device()]
  });

  assert.equal(state.registration.status, "AVAILABLE");
  assert.equal(state.devices[0]?.installationId, installationId);
});

test("supports an honestly disabled registration state", () => {
  const state = webPushSubscriptionsState({
    registration: {
      status: "DISABLED",
      reason: "SERVER_NOT_CONFIGURED",
      maxActiveDevices: 20,
      deliveryAvailable: false,
      testDeliveryAvailable: false
    },
    devices: []
  });

  assert.equal(state.registration.status, "DISABLED");
});

test("rejects any secret or unknown field from the owner response", () => {
  for (const unsafe of [
    { ...device(), endpoint: "https://push.example.test/secret" },
    { ...device(), p256dh: "secret" },
    { ...device(), encryptedBundle: "ciphertext" }
  ]) {
    assert.throws(() => webPushDeviceSummary(unsafe), DomainError);
  }
});

test("rejects inconsistent lifecycle and delivery projections", () => {
  for (const inconsistent of [
    {
      ...device(),
      statusReason: "USER_REVOKED",
      revokedAt: "2026-07-29T10:00:00.000Z"
    },
    {
      ...device(),
      status: "REVOKED"
    },
    {
      ...device(),
      status: "REVOKED",
      statusReason: "PUSH_SERVICE_GONE",
      revokedAt: "2026-07-29T10:00:00.000Z"
    },
    {
      ...device(),
      status: "EXPIRED",
      statusReason: "USER_REVOKED",
      expiredAt: "2026-07-29T10:00:00.000Z"
    },
    {
      ...device(),
      lastDeliveryAt: "2026-07-29T10:00:00.000Z"
    },
    {
      ...device(),
      lastDeliveryStatus: "DELIVERED"
    }
  ]) {
    assert.throws(
      () => webPushDeviceSummary(inconsistent),
      DomainError
    );
  }
});

test("maps consistent revoked and expired tombstones", () => {
  const revoked = webPushDeviceSummary({
    ...device(),
    status: "REVOKED",
    statusReason: "USER_REVOKED",
    revokedAt: "2026-07-29T10:00:00.000Z"
  });
  const expired = webPushDeviceSummary({
    ...device(),
    status: "EXPIRED",
    statusReason: "PUSH_SERVICE_GONE",
    expiredAt: "2026-07-29T10:00:00.000Z"
  });

  assert.equal(revoked.status, "REVOKED");
  assert.equal(expired.status, "EXPIRED");
});

test("rejects malformed registration keys and duplicate devices", () => {
  assert.throws(
    () =>
      webPushSubscriptionsState({
        registration: {
          status: "AVAILABLE",
          applicationServerKey: Buffer.concat([
            Buffer.from([0x04]),
            Buffer.alloc(64)
          ]).toString("base64url"),
          applicationServerKeyVersion: 1,
          maxActiveDevices: 20,
          deliveryAvailable: false,
          testDeliveryAvailable: false
        },
        devices: []
      }),
    DomainError
  );
  assert.throws(
    () =>
      webPushSubscriptionsState({
        registration: {
          status: "DISABLED",
          reason: "SERVER_NOT_CONFIGURED",
          maxActiveDevices: 20,
          deliveryAvailable: false,
          testDeliveryAvailable: false
        },
        devices: [device(), device()]
      }),
    DomainError
  );
});

test("maps an idempotent revoke result without delivery metadata", () => {
  assert.deepEqual(
    webPushRevokeResult({
      installationId,
      status: "REVOKED",
      revoked: false
    }),
    {
      installationId,
      status: "REVOKED",
      revoked: false
    }
  );
});

function device() {
  return {
    installationId,
    label: "Рабочий Mac",
    status: "ACTIVE",
    browser: "CHROME",
    platform: "MACOS",
    applicationServerKeyVersion: 2,
    lastDeliveryStatus: "NEVER",
    createdAt: "2026-07-29T10:00:00.000Z",
    updatedAt: "2026-07-29T10:00:00.000Z",
    version: 1
  };
}
