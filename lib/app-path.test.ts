import assert from "node:assert/strict";
import test from "node:test";
import {
  isSafeBrowserApiPath,
  safeAppReturnTo
} from "./app-path.ts";

test("accepts only local app return paths", () => {
  assert.equal(safeAppReturnTo("/app/tools"), "/app/tools");
  assert.equal(safeAppReturnTo("https://example.com"), "/app");
  assert.equal(safeAppReturnTo("//example.com/app"), "/app");
  assert.equal(
    safeAppReturnTo("/app/auth/refresh?returnTo=/app"),
    "/app"
  );
});

test("rejects path traversal and encoded browser API segments", () => {
  assert.equal(isSafeBrowserApiPath(["workspaces", "valid-id"]), true);
  assert.equal(isSafeBrowserApiPath([]), false);
  assert.equal(isSafeBrowserApiPath(["..", "internal"]), false);
  assert.equal(isSafeBrowserApiPath(["auth", "login?admin=true"]), false);
});
