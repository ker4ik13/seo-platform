import assert from "node:assert/strict";
import test from "node:test";
import { safeErrorSummary } from "./runtime-safe-error.js";

test("runtime diagnostics redact connection URLs and stay bounded", () => {
  const error = Object.assign(
    new Error(`failure at redis://user:secret@127.0.0.1:6379/${"x".repeat(300)}`),
    { code: "RUNTIME_FAILURE" }
  );
  const summary = safeErrorSummary(error);

  assert.match(summary, /^RUNTIME_FAILURE:/u);
  assert.match(summary, /\[redacted-url\]/u);
  assert.doesNotMatch(summary, /secret/u);
  assert.ok(summary.length <= 216);
});
