import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import {
  WebPushCryptoService,
  type WebPushMaterial
} from "./web-push-crypto.service.js";

const context = {
  userId: "01900000-0000-7000-8000-000000000001",
  installationId: "10000000-0000-4000-8000-000000000002",
  sessionFamilyId: "01900000-0000-7000-8000-000000000003",
  applicationServerKeyVersion: 5
};
const material: WebPushMaterial = {
  endpoint: "https://push.example.test/send/opaque-token",
  expirationTime: null,
  keys: {
    p256dh: Buffer.alloc(65, 4).toString("base64url"),
    auth: Buffer.alloc(16, 5).toString("base64url")
  }
};

test("encrypts a Web Push bundle with context-bound AES-GCM", () => {
  const crypto = testCrypto();
  const encrypted = crypto.encrypt(context, material);

  assert.equal(
    encrypted.ciphertext.includes(Buffer.from(material.endpoint)),
    false
  );
  assert.deepEqual(crypto.decrypt(context, encrypted), material);
  assert.throws(() =>
    crypto.decrypt(
      { ...context, userId: "01900000-0000-7000-8000-000000000004" },
      encrypted
    )
  );
  const tampered = Buffer.from(encrypted.ciphertext);
  tampered[0] = (tampered[0] ?? 0) ^ 1;
  assert.throws(() =>
    crypto.decrypt(context, { ...encrypted, ciphertext: tampered })
  );
});

test("keeps endpoint fingerprints versioned across key rotation", () => {
  const crypto = testCrypto();
  const fingerprints = crypto.endpointFingerprints(material.endpoint);

  assert.deepEqual(
    fingerprints.map((fingerprint) => fingerprint.keyVersion),
    [7, 8]
  );
  assert.equal(fingerprints[0]?.digest.length, 32);
  assert.equal(
    fingerprints[0]?.digest.equals(fingerprints[1]?.digest ?? Buffer.alloc(0)),
    false
  );
});

function testCrypto(): WebPushCryptoService {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return new WebPushCryptoService(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN: "p".repeat(32),
      WEB_PUSH_REGISTRATION_ENABLED: "true",
      WEB_PUSH_VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString("base64url"),
      WEB_PUSH_VAPID_KEY_VERSION: "5",
      WEB_PUSH_ENDPOINT_ORIGINS: "https://push.example.test",
      WEB_PUSH_SUBSCRIPTION_KEYS: [
        `3:${Buffer.alloc(32, 1).toString("base64url")}`,
        `4:${Buffer.alloc(32, 2).toString("base64url")}`
      ].join(","),
      WEB_PUSH_ACTIVE_SUBSCRIPTION_KEY_VERSION: "4",
      WEB_PUSH_FINGERPRINT_KEYS: [
        `7:${Buffer.alloc(32, 3).toString("base64url")}`,
        `8:${Buffer.alloc(32, 4).toString("base64url")}`
      ].join(","),
      WEB_PUSH_ACTIVE_FINGERPRINT_KEY_VERSION: "8"
    })
  );
}
