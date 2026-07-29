import assert from "node:assert/strict";
import test from "node:test";
import { loadAppConfig } from "./app-config.js";

test("uses the SEO service default port", () => {
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test"
  });

  assert.equal(config.port, 4001);
  assert.equal(config.nats.url, "nats://localhost:4222");
});

test("requires internal authentication in production", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test"
      }),
    /INTERNAL_API_TOKEN/u
  );

  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test",
        INTERNAL_API_TOKEN: "i".repeat(32)
      }),
    /JOBS_TO_SEO_RANK_TOKEN/u
  );
});

test("keeps generic and secret-bearing rank tokens distinct", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test",
        INTERNAL_API_TOKEN: "s".repeat(32),
        JOBS_TO_SEO_RANK_TOKEN: "s".repeat(32)
      }),
    /must differ/u
  );

  const config = loadAppConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test",
    INTERNAL_API_TOKEN: "i".repeat(32),
    JOBS_TO_SEO_RANK_TOKEN: "r".repeat(32)
  });
  assert.equal(config.jobsToSeoRankToken, "r".repeat(32));
});
