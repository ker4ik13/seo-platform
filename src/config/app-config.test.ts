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
  assert.equal(config.malwareScanner.enabled, false);
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

test("loads bounded multipart upload defaults", () => {
  const config = loadAppConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test"
  });

  assert.equal(config.uploads.partSizeBytes, 8 * 1_024 * 1_024);
  assert.equal(config.uploads.maxSizeBytes, 5 * 1_024 * 1_024 * 1_024);
  assert.equal(config.uploads.inspectionLeaseMinutes, 30);
  assert.equal(config.uploads.inspectionDispatchSeconds, 30);
  assert.equal(config.uploads.inspectionHeartbeatSeconds, 60);
  assert.equal(config.uploads.inspectionConcurrency, 2);
  assert.equal(config.imports.parseLeaseMinutes, 30);
  assert.equal(config.imports.parseConcurrency, 2);
  assert.equal(config.imports.stagingBatchRows, 1_000);
  assert.equal(config.imports.previewRows, 20);
});

test("requires a host when malware scanning is enabled", () => {
  assert.throws(
    () =>
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        MALWARE_SCANNER_ENABLED: "true"
      }),
    /MALWARE_SCANNER_HOST/u
  );
});
