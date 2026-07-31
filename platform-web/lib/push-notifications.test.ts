import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import test from "node:test";
import {
  applicationServerKeyBytes,
  currentWebPushDeviceReady,
  deriveBrowserPushViewState,
  parseWebPushDeviceMutation,
  parseWebPushRevokeMutation,
  parseWebPushSubscriptionsState,
  serializeWebPushRegistration,
  webPushDeviceNeedsReconciliation,
  webPushFeatureSupport,
  webPushSubscriptionMatchesInput
} from "./push-notifications.ts";

const applicationKeyAgreement = createECDH("prime256v1");
applicationKeyAgreement.generateKeys();
const applicationServerKey =
  applicationKeyAgreement.getPublicKey().toString("base64url");
const subscriptionKeyAgreement = createECDH("prime256v1");
subscriptionKeyAgreement.generateKeys();
const p256dh = subscriptionKeyAgreement.getPublicKey();
const auth = Buffer.alloc(16, 7);
const installationId = "01900000-0000-7000-8000-000000000001";
const otherInstallationId = "01900000-0000-7000-8000-000000000002";
const timestamp = "2026-07-29T12:00:00.000Z";

test("detects every Web Push runtime boundary without prompting", () => {
  assert.deepEqual(
    webPushFeatureSupport({
      inBrowser: true,
      secureContext: false,
      notificationSupported: true,
      serviceWorkerSupported: true,
      pushManagerSupported: true,
      permission: "granted"
    }),
    { supported: false, reason: "INSECURE_CONTEXT" }
  );
  assert.deepEqual(
    webPushFeatureSupport({
      inBrowser: true,
      secureContext: true,
      notificationSupported: true,
      serviceWorkerSupported: true,
      pushManagerSupported: true,
      permission: "default"
    }),
    { supported: true, permission: "default" }
  );
});

test("derives explicit permission, offline, registration and active states", () => {
  const supported = {
    supported: true,
    permission: "default"
  } as const;
  const base = {
    loading: false,
    registrationStatus: "AVAILABLE" as const,
    featureSupport: supported,
    ownerConflict: false,
    registering: false,
    active: false,
    online: true,
    hasError: false
  };
  assert.equal(deriveBrowserPushViewState(base), "PERMISSION_DEFAULT");
  assert.equal(
    deriveBrowserPushViewState({ ...base, online: false }),
    "OFFLINE"
  );
  assert.equal(
    deriveBrowserPushViewState({ ...base, registering: true }),
    "REGISTERING"
  );
  assert.equal(
    deriveBrowserPushViewState({ ...base, active: true }),
    "ACTIVE"
  );
  assert.equal(
    deriveBrowserPushViewState({
      ...base,
      registrationStatus: "DISABLED"
    }),
    "SERVER_DISABLED"
  );
});

test("requires VAPID version reconciliation before a device is ready", () => {
  const state = validState();
  const device = state.devices[0];
  assert.equal(
    currentWebPushDeviceReady(
      device,
      state.registration,
      true,
      "granted"
    ),
    true
  );
  const rotatedRegistration = {
    ...state.registration,
    applicationServerKeyVersion: 2
  };
  assert.equal(
    currentWebPushDeviceReady(
      device,
      rotatedRegistration,
      true,
      "granted"
    ),
    false
  );
  assert.equal(
    webPushDeviceNeedsReconciliation(
      device,
      rotatedRegistration,
      false
    ),
    true
  );
});

test("strictly parses a redacted subscriptions state", () => {
  const state = validState();
  assert.deepEqual(parseWebPushSubscriptionsState(state), state);
  assert.throws(
    () =>
      parseWebPushSubscriptionsState({
        ...state,
        devices: [
          {
            ...state.devices[0],
            endpoint: "https://push.example.test/secret"
          }
        ]
      }),
    /некорректное состояние Web Push/u
  );
  assert.throws(
    () =>
      parseWebPushSubscriptionsState({
        ...state,
        registration: {
          ...state.registration,
          privateKey: "must-not-cross-the-boundary"
        }
      }),
    /некорректное состояние Web Push/u
  );
  assert.throws(
    () =>
      parseWebPushSubscriptionsState({
        ...state,
        devices: [
          {
            ...state.devices[0],
            statusReason: "USER_REVOKED"
          }
        ]
      }),
    /некорректное состояние Web Push/u
  );
  assert.throws(
    () =>
      parseWebPushSubscriptionsState({
        ...state,
        devices: [
          {
            ...state.devices[0],
            lastDeliveryAt: timestamp
          }
        ]
      }),
    /некорректное состояние Web Push/u
  );
});

test("mutation responses must belong to the requested installation", () => {
  const device = validState().devices[0];
  assert.deepEqual(
    parseWebPushDeviceMutation(device, installationId),
    device
  );
  assert.throws(
    () => parseWebPushDeviceMutation(device, otherInstallationId),
    /некорректное состояние Web Push/u
  );

  const revokeResult = {
    installationId,
    status: "REVOKED",
    revoked: true
  };
  assert.deepEqual(
    parseWebPushRevokeMutation(revokeResult, installationId),
    revokeResult
  );
  assert.throws(
    () =>
      parseWebPushRevokeMutation(
        revokeResult,
        otherInstallationId
      ),
    /некорректное состояние Web Push/u
  );
});

test("serializes only the exact browser subscription contract", () => {
  const command = serializeWebPushRegistration({
    label: "  Рабочий Mac  ",
    intent: "ENABLE",
    applicationServerKeyVersion: 2,
    subscription: {
      endpoint: "https://push.example.test/subscriptions/opaque",
      expirationTime: null,
      getKey(name) {
        return Uint8Array.from(name === "p256dh" ? p256dh : auth).buffer;
      }
    }
  });

  assert.deepEqual(command, {
    label: "Рабочий Mac",
    intent: "ENABLE",
    applicationServerKeyVersion: 2,
    subscription: {
      endpoint: "https://push.example.test/subscriptions/opaque",
      expirationTime: null,
      keys: {
        p256dh: p256dh.toString("base64url"),
        auth: auth.toString("base64url")
      }
    }
  });
  assert.equal("userId" in command, false);
  assert.equal("sessionFamilyId" in command, false);
});

test("binds reconciliation completion to the sent local subscription", () => {
  const sentSubscription = pushSubscription(
    "https://push.example.test/subscriptions/sent"
  );
  const command = serializeWebPushRegistration({
    label: "Рабочий Mac",
    intent: "RECONCILE",
    applicationServerKeyVersion: 1,
    subscription: sentSubscription
  });

  assert.equal(
    webPushSubscriptionMatchesInput(
      sentSubscription,
      command.subscription
    ),
    true
  );
  assert.equal(
    webPushSubscriptionMatchesInput(
      pushSubscription(
        "https://push.example.test/subscriptions/rotated"
      ),
      command.subscription
    ),
    false
  );
});

test("converts only canonical uncompressed VAPID keys", () => {
  assert.deepEqual(
    applicationServerKeyBytes(applicationServerKey),
    Uint8Array.from(applicationKeyAgreement.getPublicKey())
  );
  assert.throws(
    () => applicationServerKeyBytes(`${applicationServerKey}=`),
    /некорректное состояние Web Push/u
  );
});

function validState() {
  return {
    registration: {
      status: "AVAILABLE" as const,
      applicationServerKey,
      applicationServerKeyVersion: 1,
      maxActiveDevices: 20,
      deliveryAvailable: true,
      testDeliveryAvailable: false as const
    },
    devices: [
      {
        installationId,
        label: "Рабочий Mac",
        status: "ACTIVE" as const,
        browser: "SAFARI" as const,
        platform: "MACOS" as const,
        applicationServerKeyVersion: 1,
        lastDeliveryStatus: "NEVER" as const,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1
      }
    ]
  };
}

function pushSubscription(endpoint: string) {
  return {
    endpoint,
    expirationTime: null,
    getKey(name: "p256dh" | "auth") {
      return Uint8Array.from(name === "p256dh" ? p256dh : auth).buffer;
    }
  };
}
