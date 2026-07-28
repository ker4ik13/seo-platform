import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { requiredIdempotencyKey } from "../common/idempotency-key.js";
import {
  completeUploadInput,
  createUploadInput,
  createUploadPartUrlsInput
} from "./upload-input.js";

test("parses a CSV upload declaration", () => {
  assert.deepEqual(
    createUploadInput({
      fileName: "keywords.csv",
      mediaType: "text/csv",
      sizeBytes: "1024",
      checksumSha256: "A".repeat(64)
    }),
    {
      fileName: "keywords.csv",
      mediaType: "text/csv",
      sizeBytes: "1024",
      checksumSha256: "a".repeat(64)
    }
  );
  assert.deepEqual(
    createUploadInput({
      fileName: "keywords.tsv",
      mediaType: "text/tab-separated-values",
      sizeBytes: "2048"
    }),
    {
      fileName: "keywords.tsv",
      mediaType: "text/tab-separated-values",
      sizeBytes: "2048"
    }
  );
});

test("rejects unsupported files and missing idempotency keys", () => {
  assert.throws(
    () =>
      createUploadInput({
        fileName: "script.exe",
        mediaType: "application/octet-stream",
        sizeBytes: "1",
        checksumSha256: "a".repeat(64)
      }),
    DomainError
  );
  assert.throws(() => requiredIdempotencyKey(undefined), DomainError);
});

test("parses upload part commands", () => {
  assert.deepEqual(createUploadPartUrlsInput({ partNumbers: [1, 3] }), {
    partNumbers: [1, 3]
  });
  assert.equal(
    completeUploadInput({
      parts: [
        {
          partNumber: 1,
          etag: "\"d41d8cd98f00b204e9800998ecf8427e\""
        }
      ]
    }).parts.length,
    1
  );
});
