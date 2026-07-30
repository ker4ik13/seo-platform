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
  it("uses safe local defaults for development networking", () => {
    const config = loadAppConfig({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://test"
    });

    assert.equal(config.bindAddress, "127.0.0.1");
    assert.deepEqual(config.webOrigins, ["http://localhost:3000"]);
  });

  it("allows only explicit loopback or all-interface bind addresses", () => {
    assert.equal(
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        BIND_ADDRESS: "0.0.0.0"
      }).bindAddress,
      "0.0.0.0"
    );
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          BIND_ADDRESS: "localhost"
        }),
      /BIND_ADDRESS must be 127\.0\.0\.1 or 0\.0\.0\.0/u
    );
  });

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
          DATABASE_URL: "postgresql://test:test@localhost:5432/test",
          WEB_ORIGINS: "https://app.example.test"
        }),
      /PLATFORM_API_TO_REALTIME_TOKEN/
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

  it("rejects non-canonical, duplicate and insecure production Web origins", () => {
    for (const value of [
      "https://app.example.test/path",
      "https://app.example.test,https://app.example.test",
      "http://app.example.test"
    ]) {
      assert.throws(
        () =>
          loadAppConfig({
            ...productionEventEnv(),
            WEB_ORIGINS: value
          }),
        /WEB_ORIGINS/u
      );
    }
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

  it("rejects every documented general token placeholder and unsafe value", () => {
    const placeholders = {
      PLATFORM_API_TO_REALTIME_TOKEN:
        "replace-with-a-distinct-random-platform-api-token",
      PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN:
        "replace-with-a-distinct-random-notification-token"
    } as const;

    for (const [key, value] of Object.entries(placeholders)) {
      assert.throws(
        () =>
          loadAppConfig({
            NODE_ENV: "test",
            DATABASE_URL: "postgresql://test",
            [key]: value
          }),
        new RegExp(`${key}.*example placeholder`, "u")
      );
    }

    for (const value of [
      `${"x".repeat(31)} `,
      `${"x".repeat(31)},`,
      `${"x".repeat(31)}\n`,
      "x".repeat(513)
    ]) {
      assert.throws(
        () =>
          loadAppConfig({
            NODE_ENV: "test",
            DATABASE_URL: "postgresql://test",
            PLATFORM_API_TO_REALTIME_TOKEN: value
          }),
        /visible ASCII characters without whitespace or commas/u
      );
    }
  });

  it("rejects reused and retired general service tokens", () => {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          PLATFORM_API_TO_REALTIME_TOKEN: "x".repeat(32),
          PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN: "x".repeat(32)
        }),
      /generated distinct token/u
    );
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          INTERNAL_API_TOKEN: "x".repeat(32)
        }),
      /INTERNAL_API_TOKEN is no longer supported/u
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

  it("keeps the durable event consumer disabled by default outside production", () => {
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test"
    });

    assert.equal(config.eventConsumer.enabled, false);
    assert.equal(config.eventConsumer.fetchExpiresMs, 1_000);
    assert.equal(config.eventConsumer.maxPayloadBytes, 65_536);
  });

  it("requires the durable event consumer and exact topology in production", () => {
    assert.throws(
      () => loadAppConfig(productionEventEnv({
        NATS_EVENT_CONSUMER_ENABLED: "false"
      })),
      /NATS_EVENT_CONSUMER_ENABLED=true is required/u
    );

    const config = loadAppConfig(productionEventEnv());
    assert.equal(config.bindAddress, "0.0.0.0");
    assert.deepEqual(config.eventConsumer, {
      enabled: true,
      environment: "prod",
      streamName: "IDENTITY_EVENTS",
      durableName: "realtime_session_family_revoked_v1",
      subject: "prod.identity.session-family.revoked.v1",
      deadLetterStreamName: "DOMAIN_EVENTS_DLQ",
      deadLetterSubject:
        "prod.dlq.realtime.identity.session-family.revoked.v1",
      fetchExpiresMs: 1_000,
      maxAttempts: 8,
      retryBaseMs: 1_000,
      retryMaxMs: 60_000,
      publishTimeoutMs: 5_000,
      maxPayloadBytes: 65_536,
      shutdownGraceMs: 10_000
    });
  });

  it("rejects normalized, placeholder and non-canonical event topology identifiers", () => {
    for (const [key, value] of [
      ["NATS_EVENT_ENVIRONMENT", " prod "],
      ["NATS_EVENT_STREAM", " IDENTITY_EVENTS"],
      ["NATS_EVENT_CONSUMER_DURABLE", "realtime_session_family_revoked_v1 "],
      ["NATS_EVENT_DLQ_STREAM", " DOMAIN_EVENTS_DLQ"],
      [
        "NATS_EVENT_DLQ_SUBJECT",
        "prod.dlq.realtime.identity.session-family.revoked.v1 "
      ]
    ] as const) {
      assert.throws(
        () => loadAppConfig(productionEventEnv({ [key]: value })),
        /surrounding whitespace/u
      );
    }

    assert.throws(
      () => loadAppConfig(productionEventEnv({
        NATS_EVENT_ENVIRONMENT: "example"
      })),
      /canonical lowercase NATS token/u
    );
    assert.throws(
      () => loadAppConfig(productionEventEnv({
        NATS_EVENT_STREAM: "PLATFORM_EVENTS"
      })),
      /must be exactly IDENTITY_EVENTS/u
    );
    assert.throws(
      () => loadAppConfig(productionEventEnv({
        NATS_EVENT_DLQ_SUBJECT:
          "prod.dlq.realtime.identity.other-event.v1"
      })),
      /NATS_EVENT_DLQ_SUBJECT must be exactly/u
    );
  });

  it("enforces safe event timing and source payload bounds", () => {
    for (const key of [
      "NATS_EVENT_RETRY_BASE_MS",
      "NATS_EVENT_RETRY_MAX_MS",
      "NATS_EVENT_PUBLISH_TIMEOUT_MS",
      "NATS_EVENT_SHUTDOWN_GRACE_MS"
    ] as const) {
      assert.throws(
        () => loadAppConfig(productionEventEnv({ [key]: "99" })),
        /must be at least 100/u
      );
    }
    assert.throws(
      () => loadAppConfig(productionEventEnv({
        NATS_EVENT_FETCH_EXPIRES_MS: "999"
      })),
      /NATS_EVENT_FETCH_EXPIRES_MS must be at least 1000/u
    );
    assert.throws(
      () => loadAppConfig(productionEventEnv({
        NATS_EVENT_MAX_PAYLOAD_BYTES: "65537"
      })),
      /must be no greater than 65536/u
    );
    assert.throws(
      () => loadAppConfig(productionEventEnv({
        NATS_EVENT_RETRY_BASE_MS: "2000",
        NATS_EVENT_RETRY_MAX_MS: "1000"
      })),
      /must be greater than or equal/u
    );
  });
});

function productionEventEnv(
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test",
    WEB_ORIGINS: "https://app.example.test",
    PLATFORM_API_TO_REALTIME_TOKEN: "p".repeat(32),
    PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN: "n".repeat(32),
    NATS_EVENT_CONSUMER_ENABLED: "true",
    NATS_EVENT_ENVIRONMENT: "prod",
    NATS_EVENT_STREAM: "IDENTITY_EVENTS",
    NATS_EVENT_CONSUMER_DURABLE:
      "realtime_session_family_revoked_v1",
    NATS_EVENT_DLQ_STREAM: "DOMAIN_EVENTS_DLQ",
    NATS_EVENT_DLQ_SUBJECT:
      "prod.dlq.realtime.identity.session-family.revoked.v1",
    ...overrides
  };
}
