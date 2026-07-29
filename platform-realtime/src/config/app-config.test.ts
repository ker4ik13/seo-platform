import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { describe, it } from "node:test";
import { loadAppConfig } from "./app-config.js";

const encryptionKey = Buffer.alloc(32, 1).toString("base64url");
const fingerprintKey = Buffer.alloc(32, 2).toString("base64url");
const vapidKeyPair = createECDH("prime256v1");
vapidKeyPair.generateKeys();
const vapidPublicKey = vapidKeyPair
  .getPublicKey()
  .toString("base64url");

describe("loadAppConfig", () => {
  it("parses allowed browser origins", () => {
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      WEB_ORIGINS: "https://app.example.test, https://admin.example.test"
    });

    assert.deepEqual(config.webOrigins, [
      "https://app.example.test",
      "https://admin.example.test"
    ]);
  });

  it("requires a database URL", () => {
    assert.throws(() => loadAppConfig({ NODE_ENV: "test" }), /DATABASE_URL/);
  });

  it("requires internal authentication in production", () => {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://test:test@localhost:5432/test"
        }),
      /INTERNAL_API_TOKEN/
    );
  });

  it("parses a complete dependency-free Web Push registration config", () => {
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN: "p".repeat(32),
      WEB_PUSH_REGISTRATION_ENABLED: "true",
      WEB_PUSH_VAPID_PUBLIC_KEY: vapidPublicKey,
      WEB_PUSH_VAPID_KEY_VERSION: "3",
      WEB_PUSH_ENDPOINT_ORIGINS:
        "https://fcm.googleapis.com,https://updates.push.services.mozilla.com",
      WEB_PUSH_SUBSCRIPTION_KEYS: `4:${encryptionKey}`,
      WEB_PUSH_ACTIVE_SUBSCRIPTION_KEY_VERSION: "4",
      WEB_PUSH_FINGERPRINT_KEYS: `7:${fingerprintKey}`,
      WEB_PUSH_ACTIVE_FINGERPRINT_KEY_VERSION: "7",
      WEB_PUSH_MAX_ACTIVE_DEVICES: "12"
    });

    assert.equal(config.webPush.registrationEnabled, true);
    assert.equal(config.webPush.applicationServerKeyVersion, 3);
    assert.deepEqual(config.webPush.endpointOrigins, [
      "https://fcm.googleapis.com",
      "https://updates.push.services.mozilla.com"
    ]);
    assert.equal(config.webPush.subscriptionKeys.get(4)?.length, 32);
    assert.equal(config.webPush.fingerprintKeys.get(7)?.length, 32);
    assert.equal(config.webPush.maxActiveDevices, 12);
  });

  it("fails closed for incomplete or reused Web Push key material", () => {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          WEB_PUSH_REGISTRATION_ENABLED: "true"
        }),
      /incomplete/
    );
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          WEB_PUSH_SUBSCRIPTION_KEYS: `1:${encryptionKey}`,
          WEB_PUSH_FINGERPRINT_KEYS: `2:${encryptionKey}`
        }),
      /distinct key material/
    );
  });

  it("rejects the documented notification token placeholder", () => {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN:
            "replace-with-a-distinct-random-notification-token"
        }),
      /must be a generated distinct token/u
    );
  });

  it("rejects unsafe Web Push endpoint origins", () => {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          WEB_PUSH_ENDPOINT_ORIGINS: "https://127.0.0.1"
        }),
      /public HTTPS origins/
    );
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          WEB_PUSH_ENDPOINT_ORIGINS: "https://push.example.test/path"
        }),
      /public HTTPS origins/
    );
  });
});
