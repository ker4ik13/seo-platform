import assert from "node:assert/strict";
import test from "node:test";
import { loadAppConfig } from "./app-config.js";

test("keeps optional adapters disabled by default", () => {
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test"
  });

  assert.equal(config.s3.enabled, false);
  assert.equal(config.email.enabled, false);
});

test("requires S3 buckets when S3 is enabled", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        S3_ENABLED: "true"
      }),
    { message: "S3 is enabled but credentials or buckets are incomplete" }
  );
});
