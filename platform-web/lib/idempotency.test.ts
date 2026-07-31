import assert from "node:assert/strict";
import test from "node:test";
import {
  browserIdempotencyKey,
  stableIdempotencyCommand
} from "./idempotency.ts";

test("creates a browser idempotency key with a bounded command scope", () => {
  assert.equal(
    browserIdempotencyKey(
      "billing-checkout",
      () => "018f8f83-9a74-7d31-8f2e-f63916a1d502"
    ),
    "billing-checkout:018f8f83-9a74-7d31-8f2e-f63916a1d502"
  );
});

test("rejects unsafe browser idempotency scopes and generated values", () => {
  assert.throws(
    () => browserIdempotencyKey("Billing checkout", () => "safe"),
    /Invalid idempotency scope/u
  );
  assert.throws(
    () => browserIdempotencyKey("billing-checkout", () => "unsafe/value"),
    /Invalid idempotency key/u
  );
});

test("keeps an existing stable command only for the same payload", () => {
  const first = stableIdempotencyCommand(
    undefined,
    "payload-a",
    () => "key-a"
  );
  assert.equal(
    stableIdempotencyCommand(first, "payload-a", () => "key-b"),
    first
  );
  assert.deepEqual(
    stableIdempotencyCommand(first, "payload-b", () => "key-b"),
    { payloadSignature: "payload-b", key: "key-b" }
  );
});
