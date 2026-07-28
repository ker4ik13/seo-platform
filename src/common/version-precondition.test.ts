import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./domain-error.js";
import { requiredVersion } from "./version-precondition.js";

test("parses quoted and weak entity versions", () => {
  assert.equal(requiredVersion('"v12"'), 12);
  assert.equal(requiredVersion('W/"7"'), 7);
});

test("requires If-Match for mutations", () => {
  assert.throws(
    () => requiredVersion(undefined),
    (error) =>
      error instanceof DomainError &&
      error.statusCode === 428 &&
      error.code === "VERSION_CONFLICT"
  );
});

test("rejects malformed entity versions", () => {
  assert.throws(
    () => requiredVersion("latest"),
    (error) =>
      error instanceof DomainError && error.code === "VALIDATION_FAILED"
  );
});
