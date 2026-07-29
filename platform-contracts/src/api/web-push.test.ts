import assert from "node:assert/strict";
import test from "node:test";
import {
  webPushBrowsers,
  webPushDeliveryStatuses,
  webPushDeviceStatuses,
  webPushDeviceStatusReasons,
  webPushDisabledReasons,
  webPushPlatforms,
  webPushRegistrationIntents,
  webPushRegistrationStatuses,
  type InternalRenameWebPushDeviceInput,
  type InternalUpsertWebPushSubscriptionInput,
  type WebPushSubscriptionsState
} from "./web-push.js";
import { errorCodes } from "../http/errors.js";

const APPLICATION_SERVER_KEY_FIXTURE =
  "BOr7_GsBMYZylGPToUj50H4fPAMasH8PAyXp0Be9sE5H1Vmp7qzI7fEqysXcXKcJ0opN0hkST8Gf4B1_gP2E9uY";

const publicStateFixture = {
  registration: {
    status: "AVAILABLE",
    applicationServerKey: APPLICATION_SERVER_KEY_FIXTURE,
    applicationServerKeyVersion: 3,
    maxActiveDevices: 20,
    deliveryAvailable: false,
    testDeliveryAvailable: false
  },
  devices: [
    {
      installationId: "01900000-0000-7000-8000-000000000001",
      label: "Рабочий MacBook",
      status: "ACTIVE",
      browser: "CHROME",
      platform: "MACOS",
      applicationServerKeyVersion: 3,
      lastDeliveryStatus: "NEVER",
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
      version: 1
    },
    {
      installationId: "01900000-0000-7000-8000-000000000002",
      label: "Телефон",
      status: "REVOKED",
      statusReason: "USER_REVOKED",
      browser: "SAFARI",
      platform: "IOS",
      applicationServerKeyVersion: 2,
      lastDeliveryStatus: "FAILED",
      lastDeliveryAt: "2026-07-28T10:00:00.000Z",
      createdAt: "2026-07-27T08:00:00.000Z",
      updatedAt: "2026-07-28T11:00:00.000Z",
      revokedAt: "2026-07-28T11:00:00.000Z",
      version: 2
    }
  ]
} as const satisfies WebPushSubscriptionsState;

test("web push contracts use finite lifecycle vocabularies", () => {
  assert.deepEqual(webPushRegistrationStatuses, ["AVAILABLE", "DISABLED"]);
  assert.deepEqual(webPushDisabledReasons, ["SERVER_NOT_CONFIGURED"]);
  assert.deepEqual(webPushDeviceStatuses, [
    "ACTIVE",
    "REVOKED",
    "EXPIRED"
  ]);
  assert.deepEqual(webPushDeviceStatusReasons, [
    "USER_REVOKED",
    "SESSION_REVOKED",
    "PERMISSION_REVOKED",
    "PUSH_SERVICE_GONE",
    "ACCOUNT_CHANGED"
  ]);
  assert.deepEqual(webPushDeliveryStatuses, [
    "NEVER",
    "DELIVERED",
    "FAILED"
  ]);
  assert.deepEqual(webPushRegistrationIntents, ["ENABLE", "RECONCILE"]);
  assert.deepEqual(webPushBrowsers, [
    "CHROME",
    "EDGE",
    "FIREFOX",
    "OPERA",
    "SAFARI",
    "OTHER"
  ]);
  assert.deepEqual(webPushPlatforms, [
    "ANDROID",
    "CHROMEOS",
    "IOS",
    "LINUX",
    "MACOS",
    "WINDOWS",
    "OTHER"
  ]);
});

test("web push boundary failures have stable public error codes", () => {
  for (const code of [
    "VERSION_CONFLICT",
    "VAPID_KEY_VERSION_CHANGED",
    "PUSH_SUBSCRIPTION_ALREADY_BOUND",
    "PUSH_DEVICE_LIMIT_REACHED",
    "EXPLICIT_ENABLE_REQUIRED",
    "WEB_PUSH_UNAVAILABLE"
  ] as const) {
    assert.equal(errorCodes.includes(code), true, `missing error code: ${code}`);
  }
});

test("available registration exposes only a public VAPID key and disabled delivery", () => {
  assert.match(
    publicStateFixture.registration.applicationServerKey,
    /^[A-Za-z0-9_-]+$/u
  );
  assert.equal(
    publicStateFixture.registration.applicationServerKey.includes("="),
    false
  );
  assert.equal(
    Number.isSafeInteger(
      publicStateFixture.registration.applicationServerKeyVersion
    ),
    true
  );
  assert.equal(
    publicStateFixture.registration.applicationServerKeyVersion > 0,
    true
  );
  assert.equal(publicStateFixture.registration.deliveryAvailable, false);
  assert.equal(publicStateFixture.registration.testDeliveryAvailable, false);
});

test("public web push state redacts endpoint, key material and trusted context", () => {
  const publicJson = JSON.stringify(publicStateFixture);
  const privateSentinels = [
    "https://push-service.example/subscription-private",
    "p256dh-private",
    "auth-private",
    "session-family-private",
    "user-private"
  ];

  for (const sentinel of privateSentinels) {
    assert.equal(publicJson.includes(sentinel), false);
  }

  const forbiddenKeys = new Set([
    "endpoint",
    "keys",
    "p256dh",
    "auth",
    "userId",
    "sessionFamilyId",
    "encryptedBundle",
    "ciphertext",
    "nonce",
    "tag",
    "endpointFingerprint",
    "materialFingerprint"
  ]);

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    if (value === null || typeof value !== "object") {
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `forbidden key: ${key}`);
      visit(child);
    }
  };

  visit(publicStateFixture);
});

test("internal inputs carry trusted context while public state stays redacted", () => {
  const upsert = {
    label: "Рабочий MacBook",
    intent: "ENABLE",
    applicationServerKeyVersion: 3,
    subscription: {
      endpoint: "https://push-service.example/subscription-private",
      expirationTime: null,
      keys: {
        p256dh:
          "BFF2dkP4PzhsuCjKQ-Keej9PV2W-8N65y4-RMya0nrmrNyD5hKWGcCFhb2UQr9ifFTyKNDnq61UAIy0WKe_RZ5M",
        auth: "cHJpdmF0ZS1hdXRoLWtleQ"
      }
    },
    userId: "01900000-0000-7000-8000-000000000003",
    sessionFamilyId: "01900000-0000-7000-8000-000000000004",
    browser: "CHROME",
    platform: "MACOS"
  } as const satisfies InternalUpsertWebPushSubscriptionInput;

  const rename = {
    label: "Основной ноутбук",
    userId: upsert.userId,
    version: 2
  } as const satisfies InternalRenameWebPushDeviceInput;

  assert.equal(upsert.intent, "ENABLE");
  assert.equal(upsert.subscription.expirationTime, null);
  assert.equal(rename.version, 2);
  assert.equal("endpoint" in publicStateFixture.devices[0], false);
  assert.equal("sessionFamilyId" in publicStateFixture.devices[0], false);
});
