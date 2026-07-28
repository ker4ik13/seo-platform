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
        AUTH_EXPOSE_DEVELOPMENT_TOKENS: "true"
      }),
    {
      message: "AUTH_EXPOSE_DEVELOPMENT_TOKENS cannot be enabled in production"
    }
  );
});
