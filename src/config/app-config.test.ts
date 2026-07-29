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
  assert.equal(config.port, 4100);
  assert.equal(config.services.seoData, "http://seo");
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
        INTERNAL_API_TOKEN: "x".repeat(32),
        PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32),
        PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN: "n".repeat(32),
        AUTH_EXPOSE_DEVELOPMENT_TOKENS: "true"
      }),
    {
      message: "AUTH_EXPOSE_DEVELOPMENT_TOKENS cannot be enabled in production"
    }
  );
});

test("keeps the credential caller token separate from shared service auth", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        INTERNAL_API_TOKEN: "x".repeat(32),
        PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "x".repeat(32)
      }),
    /must differ from the shared internal API token/u
  );
});

test("keeps the notification caller token separate from every other internal token", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        INTERNAL_API_TOKEN: "x".repeat(32),
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
        INTERNAL_API_TOKEN: "i".repeat(32),
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
