import assert from "node:assert/strict";
import test from "node:test";
import { loadAppConfig } from "./app-config.js";

test("loads explicit service configuration", () => {
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    PORT: "4100",
    SEO_DATA_INTERNAL_URL: "http://seo",
    JOBS_INTERNAL_URL: "http://jobs",
    REALTIME_INTERNAL_URL: "http://realtime"
  });

  assert.equal(config.nodeEnv, "test");
  assert.equal(config.bindAddress, "127.0.0.1");
  assert.equal(config.port, 4100);
  assert.equal(config.services.seoData, "http://seo");
  assert.equal(config.outboxPublisher.enabled, false);
  assert.deepEqual(config.sessionExpirySweeper, {
    enabled: false,
    intervalMs: 60_000,
    batchSize: 50,
    transactionTimeoutMs: 10_000,
    lockTimeoutMs: 500
  });
  assert.deepEqual(config.billing, {
    yookassa: {
      enabled: false,
      apiBaseUrl: "https://api.yookassa.ru/v3",
      requestTimeoutMs: 10_000,
      validateWebhookSourceIp: true
    },
    reconciliation: {
      enabled: false,
      intervalMs: 60_000,
      batchSize: 25
    }
  });
});

test("requires complete YooKassa credentials and derives a safe return URL", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        YOOKASSA_ENABLED: "true",
        WEB_PUBLIC_URL: "https://app.example.test"
      }),
    /YOOKASSA_SHOP_ID/u
  );

  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    WEB_PUBLIC_URL: "https://app.example.test",
    YOOKASSA_ENABLED: "true",
    YOOKASSA_SHOP_ID: "123456",
    YOOKASSA_SECRET_KEY: "s".repeat(32)
  });
  assert.equal(
    config.billing.yookassa.returnUrl,
    "https://app.example.test/app/settings/billing?checkout=return"
  );
  assert.equal(config.billing.reconciliation.enabled, true);
});

test("keeps production YooKassa traffic on the official API with IP validation", () => {
  const enabled = {
    YOOKASSA_ENABLED: "true",
    YOOKASSA_SHOP_ID: "123456",
    YOOKASSA_SECRET_KEY: "s".repeat(32)
  };
  assert.throws(
    () =>
      loadAppConfig(
        productionEnvironment({
          ...enabled,
          YOOKASSA_API_BASE_URL: "https://provider.example.test/v3"
        })
      ),
    /official YooKassa v3 endpoint/u
  );
  assert.throws(
    () =>
      loadAppConfig(
        productionEnvironment({
          ...enabled,
          YOOKASSA_VALIDATE_WEBHOOK_SOURCE_IP: "false"
        })
      ),
    /cannot be disabled in production/u
  );
  assert.throws(
    () =>
      loadAppConfig(
        productionEnvironment({
          ...enabled,
          BILLING_RECONCILIATION_ENABLED: "false"
        })
      ),
    /BILLING_RECONCILIATION_ENABLED is required/u
  );
});

test("uses only explicit loopback or container bind addresses", () => {
  assert.equal(
    loadAppConfig(
      productionEnvironment({
        OUTBOX_PUBLISHER_ENABLED: "true",
        NATS_EVENT_ENVIRONMENT: "production",
        NATS_EVENT_STREAM: "IDENTITY_EVENTS",
        NATS_AUTH_EMAIL_STREAM: "AUTH_EMAIL_EVENTS",
        SESSION_EXPIRY_SWEEPER_ENABLED: "true"
      })
    ).bindAddress,
    "0.0.0.0"
  );
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

test("rejects an absent database URL", () => {
  assert.throws(() => loadAppConfig({ NODE_ENV: "test" }), {
    message: "Missing required environment variable: DATABASE_URL"
  });
});

test("requires authentication pepper in production", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test"
      }),
    {
      message: "AUTH_PASSWORD_PEPPER is required in production"
    }
  );
});

test("does not allow development tokens in production", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test",
        AUTH_PASSWORD_PEPPER: "production-secret",
        AUTH_DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64url"),
        PLATFORM_API_TO_SEO_DATA_TOKEN: "s".repeat(32),
        PLATFORM_API_TO_JOBS_TOKEN: "j".repeat(32),
        PLATFORM_API_TO_REALTIME_TOKEN: "r".repeat(32),
        PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32),
        PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN: "n".repeat(32),
        REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN: "w".repeat(32),
        JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: "g".repeat(32),
        JOBS_TO_PLATFORM_AUTOMATION_TOKEN: "a".repeat(32),
        JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN: "e".repeat(32),
        WEB_PUBLIC_URL: "https://example.test",
        AUTH_EXPOSE_DEVELOPMENT_TOKENS: "true"
      }),
    {
      message: "AUTH_EXPOSE_DEVELOPMENT_TOKENS cannot be enabled in production"
    }
  );
});

test("keeps every caller/audience token distinct", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        PLATFORM_API_TO_JOBS_TOKEN: "x".repeat(32),
        PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "x".repeat(32)
      }),
    /Every internal API token must be distinct/u
  );

  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        PLATFORM_API_TO_SEO_DATA_TOKEN: "x".repeat(32),
        PLATFORM_API_TO_REALTIME_TOKEN: "x".repeat(32)
      }),
    /Every internal API token must be distinct/u
  );
});

test("keeps the notification caller token separate from every other internal token", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        PLATFORM_API_TO_SEO_DATA_TOKEN: "s".repeat(32),
        PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32),
        PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN: "c".repeat(32)
      }),
    /Every internal API token must be distinct/u
  );
});

test("requires the dedicated notification caller token in production", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test",
        AUTH_PASSWORD_PEPPER: "production-secret",
        AUTH_DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64url"),
        PLATFORM_API_TO_SEO_DATA_TOKEN: "s".repeat(32),
        PLATFORM_API_TO_JOBS_TOKEN: "j".repeat(32),
        PLATFORM_API_TO_REALTIME_TOKEN: "r".repeat(32),
        PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32)
      }),
    /PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN/u
  );
});

test("rejects the documented notification token placeholder", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN:
          "replace-with-a-distinct-random-notification-token"
      }),
    /must not use an example placeholder/u
  );
});

test("requires the dedicated rank grant caller token in production", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test",
        AUTH_PASSWORD_PEPPER: "production-secret",
        AUTH_DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64url"),
        PLATFORM_API_TO_SEO_DATA_TOKEN: "s".repeat(32),
        PLATFORM_API_TO_JOBS_TOKEN: "j".repeat(32),
        PLATFORM_API_TO_REALTIME_TOKEN: "r".repeat(32),
        PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32),
        PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN: "n".repeat(32),
        REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN: "w".repeat(32)
      }),
    /JOBS_TO_PLATFORM_RANK_GRANT_TOKEN/u
  );
});

test("rejects the documented rank grant token placeholder", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        JOBS_TO_PLATFORM_RANK_GRANT_TOKEN:
          "replace-with-a-distinct-random-rank-grant-token"
      }),
    /must not use an example placeholder/u
  );
});

test("rejects every documented service-token placeholder and unsafe header value", () => {
  const placeholders = {
    PLATFORM_API_TO_SEO_DATA_TOKEN:
      "replace-with-a-distinct-random-seo-data-token",
    PLATFORM_API_TO_JOBS_TOKEN:
      "replace-with-a-distinct-random-jobs-token",
    PLATFORM_API_TO_REALTIME_TOKEN:
      "replace-with-a-distinct-random-realtime-token",
    PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN:
      "replace-with-a-distinct-random-credential-token",
    PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN:
      "replace-with-a-distinct-random-notification-token",
    REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN:
      "replace-with-a-distinct-random-delivery-authorization-token",
    JOBS_TO_PLATFORM_RANK_GRANT_TOKEN:
      "replace-with-a-distinct-random-rank-grant-token",
    JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN:
      "replace-with-a-distinct-random-auth-email-token"
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
          PLATFORM_API_TO_JOBS_TOKEN: value
        }),
      /visible ASCII characters without whitespace or commas/u
    );
  }
});

test("requires a dedicated Realtime delivery authorization token in production", () => {
  assert.throws(
    () =>
      loadAppConfig(
        productionEnvironment({
          REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN: undefined
        })
      ),
    /REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN/u
  );
});

test("keeps the Realtime delivery authorization token distinct", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN: "n".repeat(32),
        REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN: "n".repeat(32)
      }),
    /Every internal API token must be distinct/u
  );
});

test("keeps the rank grant token separate from other internal tokens", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        PLATFORM_API_TO_SEO_DATA_TOKEN: "i".repeat(32),
        PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32),
        PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN: "n".repeat(32),
        JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: "n".repeat(32)
      }),
    /Every internal API token must be distinct/u
  );
});

test("requires a distinct auth-email token and exact public origin", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        PLATFORM_API_TO_JOBS_TOKEN: "e".repeat(32),
        JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN: "e".repeat(32),
        WEB_PUBLIC_URL: "https://example.test"
      }),
    /Every internal API token must be distinct/u
  );
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN: "e".repeat(32)
      }),
    /WEB_PUBLIC_URL is required/u
  );
  for (const value of [
    "https://example.test/",
    "https://example.test/path",
    "https://example.test?query=1",
    "https://user@example.test"
  ]) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          WEB_PUBLIC_URL: value
        }),
      /WEB_PUBLIC_URL must be an explicit canonical origin/u
    );
  }
});

test("rejects the retired shared internal token", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        INTERNAL_API_TOKEN: "i".repeat(32)
      }),
    /INTERNAL_API_TOKEN is no longer supported/u
  );
});

test("requires a valid data encryption key in production", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test",
        AUTH_PASSWORD_PEPPER: "production-secret",
        AUTH_DATA_ENCRYPTION_KEY: "too-short"
      }),
    {
      message:
        "AUTH_DATA_ENCRYPTION_KEY must be a Base64URL-encoded 32-byte key"
    }
  );
});

test("requires the outbox publisher to be explicitly enabled in production", () => {
  assert.throws(() => loadAppConfig(productionEnvironment()), {
    message: "OUTBOX_PUBLISHER_ENABLED=true is required in production"
  });
});

test("requires the session expiry sweeper to be explicitly enabled in production", () => {
  const productionWithPublisher = productionEnvironment({
    OUTBOX_PUBLISHER_ENABLED: "true",
    NATS_EVENT_ENVIRONMENT: "production",
    NATS_EVENT_STREAM: "IDENTITY_EVENTS",
    NATS_AUTH_EMAIL_STREAM: "AUTH_EMAIL_EVENTS"
  });

  assert.throws(() => loadAppConfig(productionWithPublisher), {
    message:
      "SESSION_EXPIRY_SWEEPER_ENABLED=true is required in production"
  });
  assert.throws(
    () =>
      loadAppConfig({
        ...productionWithPublisher,
        SESSION_EXPIRY_SWEEPER_ENABLED: "false"
      }),
    {
      message:
        "SESSION_EXPIRY_SWEEPER_ENABLED=true is required in production"
    }
  );

  const config = loadAppConfig({
    ...productionWithPublisher,
    SESSION_EXPIRY_SWEEPER_ENABLED: "true"
  });
  assert.equal(config.sessionExpirySweeper.enabled, true);
});

test("enforces bounded session expiry polling and database waits", () => {
  const invalidValues = [
    ["SESSION_EXPIRY_SWEEPER_INTERVAL_MS", "999"],
    ["SESSION_EXPIRY_SWEEPER_INTERVAL_MS", "3600001"],
    ["SESSION_EXPIRY_SWEEPER_BATCH_SIZE", "0"],
    ["SESSION_EXPIRY_SWEEPER_BATCH_SIZE", "101"],
    ["SESSION_EXPIRY_SWEEPER_TRANSACTION_TIMEOUT_MS", "999"],
    ["SESSION_EXPIRY_SWEEPER_TRANSACTION_TIMEOUT_MS", "60001"],
    ["SESSION_EXPIRY_SWEEPER_LOCK_TIMEOUT_MS", "49"],
    ["SESSION_EXPIRY_SWEEPER_LOCK_TIMEOUT_MS", "5001"]
  ] as const;
  for (const [key, value] of invalidValues) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          [key]: value
        }),
      new RegExp(key, "u")
    );
  }

  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        SESSION_EXPIRY_SWEEPER_TRANSACTION_TIMEOUT_MS: "1000",
        SESSION_EXPIRY_SWEEPER_LOCK_TIMEOUT_MS: "1000"
      }),
    /SESSION_EXPIRY_SWEEPER_LOCK_TIMEOUT_MS must be less/u
  );
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        SESSION_EXPIRY_SWEEPER_ENABLED: "sometimes"
      }),
    /SESSION_EXPIRY_SWEEPER_ENABLED must be true or false/u
  );
});

test("requires exact JetStream routing when the outbox publisher is enabled", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        OUTBOX_PUBLISHER_ENABLED: "true"
      }),
    /NATS_EVENT_ENVIRONMENT is required/u
  );
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        OUTBOX_PUBLISHER_ENABLED: "true",
        NATS_EVENT_ENVIRONMENT: "test"
      }),
    /NATS_EVENT_STREAM is required/u
  );
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        OUTBOX_PUBLISHER_ENABLED: "true",
        NATS_EVENT_ENVIRONMENT: "test",
        NATS_EVENT_STREAM: "IDENTITY_EVENTS"
      }),
    /NATS_AUTH_EMAIL_STREAM is required/u
  );

  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test",
    OUTBOX_PUBLISHER_ENABLED: "true",
    NATS_EVENT_ENVIRONMENT: "test-eu1",
    NATS_EVENT_STREAM: "IDENTITY_EVENTS",
    NATS_AUTH_EMAIL_STREAM: "AUTH_EMAIL_EVENTS"
  });
  assert.deepEqual(config.outboxPublisher, {
    enabled: true,
    eventEnvironment: "test-eu1",
    streamName: "IDENTITY_EVENTS",
    authEmailStreamName: "AUTH_EMAIL_EVENTS",
    pollIntervalMs: 1_000,
    batchSize: 20,
    maxAttempts: 10,
    retryBaseMs: 1_000,
    retryMaxMs: 300_000,
    publishTimeoutMs: 5_000
  });
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        OUTBOX_PUBLISHER_ENABLED: "true",
        NATS_EVENT_ENVIRONMENT: "test",
        NATS_EVENT_STREAM: "IDENTITY_EVENTS",
        NATS_AUTH_EMAIL_STREAM: "IDENTITY_EVENTS"
      }),
    /must be distinct/u
  );
});

test("rejects placeholder and ambiguous JetStream routing identifiers", () => {
  for (const environment of [
    "replace-me",
    "Prod",
    "prod.eu",
    " prod",
    "prod "
  ]) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          NATS_EVENT_ENVIRONMENT: environment
        }),
      /NATS_EVENT_ENVIRONMENT must be an explicit safe environment identifier/u
    );
  }
  for (const stream of [
    "replace-me",
    "PLATFORM.EVENTS",
    "PLATFORM EVENTS",
    "*",
    "a".repeat(65)
  ]) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          NATS_EVENT_STREAM: stream
        }),
      /NATS_EVENT_STREAM must contain 1 to 64 ASCII/u
    );
  }
});

test("enforces bounded outbox polling, retry and PubAck settings", () => {
  const invalidValues = [
    ["OUTBOX_PUBLISH_INTERVAL_MS", "99"],
    ["OUTBOX_PUBLISH_BATCH_SIZE", "101"],
    ["OUTBOX_PUBLISH_MAX_ATTEMPTS", "0"],
    ["OUTBOX_PUBLISH_RETRY_BASE_MS", "60001"],
    ["OUTBOX_PUBLISH_RETRY_MAX_MS", "3600001"],
    ["OUTBOX_PUBLISH_ACK_TIMEOUT_MS", "30001"]
  ] as const;
  for (const [key, value] of invalidValues) {
    assert.throws(
      () =>
        loadAppConfig({
          NODE_ENV: "test",
          DATABASE_URL: "postgresql://test",
          [key]: value
        }),
      new RegExp(key, "u")
    );
  }

  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        OUTBOX_PUBLISH_RETRY_BASE_MS: "2000",
        OUTBOX_PUBLISH_RETRY_MAX_MS: "1000"
      }),
    /OUTBOX_PUBLISH_RETRY_MAX_MS must be greater/u
  );
});

function productionEnvironment(
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test",
    AUTH_PASSWORD_PEPPER: "production-secret",
    AUTH_DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64url"),
    PLATFORM_API_TO_SEO_DATA_TOKEN: "s".repeat(32),
    PLATFORM_API_TO_JOBS_TOKEN: "j".repeat(32),
    PLATFORM_API_TO_REALTIME_TOKEN: "r".repeat(32),
    PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32),
    PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN: "n".repeat(32),
    REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN: "w".repeat(32),
    JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: "g".repeat(32),
    JOBS_TO_PLATFORM_AUTOMATION_TOKEN: "a".repeat(32),
    JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN: "e".repeat(32),
    WEB_PUBLIC_URL: "https://example.test",
    ...overrides
  };
}
