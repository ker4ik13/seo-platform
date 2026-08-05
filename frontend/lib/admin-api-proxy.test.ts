import assert from "node:assert/strict";
import test from "node:test";
import {
  adminUpstreamPath,
  responseCookies
} from "./admin-api-proxy.ts";

test("admin proxy exposes only explicit authentication and admin routes", () => {
  assert.equal(
    adminUpstreamPath(["auth", "login"]),
    "/api/v1/auth/login"
  );
  assert.equal(
    adminUpstreamPath(["billing", "npd-receipts"]),
    "/admin-api/v1/billing/npd-receipts"
  );
  assert.equal(
    adminUpstreamPath([
      "billing",
      "npd-receipts",
      "01900000-0000-7000-8000-000000000001",
      "register-manual"
    ]),
    "/admin-api/v1/billing/npd-receipts/01900000-0000-7000-8000-000000000001/register-manual"
  );
  assert.equal(adminUpstreamPath(["auth", "register"]), undefined);
  assert.equal(adminUpstreamPath(["internal", "v1", "health"]), undefined);
  assert.equal(adminUpstreamPath(["billing", "..", "health"]), undefined);
});

test("preserves every upstream Set-Cookie value", () => {
  const headers = new Headers();
  Object.defineProperty(headers, "getSetCookie", {
    value: () => ["a=1; HttpOnly", "b=2; SameSite=Lax"]
  });
  assert.deepEqual(responseCookies(headers), [
    "a=1; HttpOnly",
    "b=2; SameSite=Lax"
  ]);
});
