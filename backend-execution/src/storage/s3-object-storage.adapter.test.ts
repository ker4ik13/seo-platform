import assert from "node:assert/strict";
import test from "node:test";
import { buildS3ObjectKey } from "./s3-object-storage.adapter.js";

test("keeps legacy object keys unchanged without a deployment prefix", () => {
  assert.equal(
    buildS3ObjectKey(undefined, "uploads", "workspace/project/file.csv"),
    "workspace/project/file.csv"
  );
});

test("isolates upload and artifact objects below the deployment prefix", () => {
  assert.equal(
    buildS3ObjectKey(
      "seo-platform/production",
      "uploads",
      "workspace/project/file.csv"
    ),
    "seo-platform/production/uploads/workspace/project/file.csv"
  );
  assert.equal(
    buildS3ObjectKey(
      "seo-platform/production",
      "artifacts",
      "workspace/project/report.xlsx"
    ),
    "seo-platform/production/artifacts/workspace/project/report.xlsx"
  );
});

test("rejects unsafe or oversized physical object keys", () => {
  for (const objectKey of ["", "/absolute", "workspace/../other/file"] as const) {
    assert.throws(
      () => buildS3ObjectKey("seo-platform/production", "uploads", objectKey),
      /Invalid S3 object key/u
    );
  }
  assert.throws(
    () =>
      buildS3ObjectKey(
        "seo-platform/production",
        "uploads",
        "a".repeat(1_024)
      ),
    /Invalid S3 object key/u
  );
  for (const prefix of ["/absolute", "folder/", "folder//nested", "folder/../other"] as const) {
    assert.throws(
      () => buildS3ObjectKey(prefix, "uploads", "workspace/file.csv"),
      /Invalid S3 object key prefix/u
    );
  }
});
