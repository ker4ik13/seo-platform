import assert from "node:assert/strict";
import test from "node:test";
import { safeRequestId } from "./request-id.js";

test("preserves a bounded trace id from the internal caller", () => {
  assert.equal(
    safeRequestId({
      headers: { "x-request-id": "request-push_001:api" }
    }),
    "request-push_001:api"
  );
});

test("replaces unsafe, ambiguous, or oversized request ids", () => {
  for (const candidate of [
    "request id",
    "request\nid",
    "x".repeat(129),
    ["first", "second"],
    undefined
  ]) {
    const generated = safeRequestId({
      headers: { "x-request-id": candidate }
    });

    assert.match(
      generated,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    );
  }
});
