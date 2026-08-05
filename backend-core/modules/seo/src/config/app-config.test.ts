import assert from "node:assert/strict";
import test from "node:test";
import { loadAppConfig } from "./app-config.js";

test("uses the SEO service default port", () => {
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test"
  });

  assert.equal(config.port, 4001);
  assert.equal(config.bindAddress, "127.0.0.1");
  assert.equal(config.nats.url, "nats://127.0.0.1:4222");
});

test("uses only explicit loopback or container bind addresses", () => {
  const production = loadAppConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test",
    PLATFORM_API_TO_SEO_DATA_TOKEN: "p".repeat(32),
    JOBS_TO_SEO_DATA_TOKEN: "j".repeat(32),
    JOBS_TO_SEO_RANK_TOKEN: "r".repeat(32),
    JOBS_TO_SEO_RANK_RESULT_TOKEN: "d".repeat(32),
    RANK_HISTORY_CURSOR_KEY: "c".repeat(32)
  });
  assert.equal(production.bindAddress, "0.0.0.0");
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
        BIND_ADDRESS: "::"
      }),
    /BIND_ADDRESS must be 127\.0\.0\.1 or 0\.0\.0\.0/u
  );
});

test("requires every inbound audience credential in production", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test"
      }),
    /PLATFORM_API_TO_SEO_DATA_TOKEN/u
  );

  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test",
        PLATFORM_API_TO_SEO_DATA_TOKEN: "p".repeat(32)
      }),
    /JOBS_TO_SEO_DATA_TOKEN/u
  );

  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test",
        PLATFORM_API_TO_SEO_DATA_TOKEN: "p".repeat(32),
        JOBS_TO_SEO_DATA_TOKEN: "j".repeat(32),
        JOBS_TO_SEO_RANK_TOKEN: "r".repeat(32)
      }),
    /JOBS_TO_SEO_RANK_RESULT_TOKEN/u
  );

  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test",
        PLATFORM_API_TO_SEO_DATA_TOKEN: "p".repeat(32),
        JOBS_TO_SEO_DATA_TOKEN: "j".repeat(32),
        JOBS_TO_SEO_RANK_TOKEN: "r".repeat(32),
        JOBS_TO_SEO_RANK_RESULT_TOKEN: "d".repeat(32)
      }),
    /RANK_HISTORY_CURSOR_KEY/u
  );
});

test("keeps all caller/audience and rank tokens distinct", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test",
        PLATFORM_API_TO_SEO_DATA_TOKEN: "s".repeat(32),
        JOBS_TO_SEO_DATA_TOKEN: "j".repeat(32),
        JOBS_TO_SEO_RANK_TOKEN: "s".repeat(32),
        JOBS_TO_SEO_RANK_RESULT_TOKEN: "x".repeat(32),
        RANK_HISTORY_CURSOR_KEY: "c".repeat(32)
      }),
    /must differ/u
  );

  const config = loadAppConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://test",
    PLATFORM_API_TO_SEO_DATA_TOKEN: "p".repeat(32),
    JOBS_TO_SEO_DATA_TOKEN: "j".repeat(32),
    JOBS_TO_SEO_RANK_TOKEN: "r".repeat(32),
    JOBS_TO_SEO_RANK_RESULT_TOKEN: "d".repeat(32),
    RANK_HISTORY_CURSOR_KEY: "c".repeat(32)
  });
  assert.equal(config.jobsToSeoRankToken, "r".repeat(32));
  assert.equal(config.jobsToSeoRankResultToken, "d".repeat(32));

  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://test",
        PLATFORM_API_TO_SEO_DATA_TOKEN: "p".repeat(32),
        JOBS_TO_SEO_DATA_TOKEN: "j".repeat(32),
        JOBS_TO_SEO_RANK_TOKEN: "r".repeat(32),
        JOBS_TO_SEO_RANK_RESULT_TOKEN: "r".repeat(32),
        RANK_HISTORY_CURSOR_KEY: "c".repeat(32)
      }),
    /must differ/u
  );

  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        PLATFORM_API_TO_SEO_DATA_TOKEN: "x".repeat(32),
        JOBS_TO_SEO_DATA_TOKEN: "x".repeat(32)
      }),
    /must differ/u
  );
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

test("rejects documented placeholders and unsafe service-secret values", () => {
  const placeholders = {
    PLATFORM_API_TO_SEO_DATA_TOKEN:
      "replace-with-a-distinct-random-platform-api-token",
    JOBS_TO_SEO_DATA_TOKEN: "replace-with-a-distinct-random-jobs-token",
    JOBS_TO_SEO_RANK_TOKEN:
      "replace-with-a-distinct-random-rank-worker-token",
    JOBS_TO_SEO_RANK_RESULT_TOKEN:
      "replace-with-a-distinct-random-rank-result-token",
    RANK_HISTORY_CURSOR_KEY: "replace-with-at-least-32-random-bytes"
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
          JOBS_TO_SEO_DATA_TOKEN: value
        }),
      /visible ASCII characters without whitespace or commas/u
    );
  }
});
