import assert from "node:assert/strict";
import test from "node:test";
import {
  adminUpstreamPath,
  proxyAdminApi,
  responseCookies
} from "./admin-api-proxy.ts";
import { NextRequest } from "next/server.js";

test("admin proxy bounds a streamed body even when Content-Length is absent", async () => {
  process.env.WEB_PUBLIC_URL = "https://app.example.test";
  process.env.PLATFORM_API_INTERNAL_URL = "http://backend-core:4000";
  const original = globalThis.fetch;
  let requests = 0, cancelled = false, pulls = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ data: {} }); };
  try {
    const stream = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(16 * 1024)); }, cancel() { cancelled = true; } });
    const request = new NextRequest("https://app.example.test/admin/api/auth/login", { method: "POST", body: stream, duplex: "half", headers: { Origin: "https://app.example.test" } } as ConstructorParameters<typeof NextRequest>[1]);
    const response = await proxyAdminApi(request, ["auth", "login"]);
    assert.equal(response.status, 413); assert.equal(requests, 0); assert.equal(cancelled, true);
    assert.ok(pulls < 10, "The proxy must stop consuming before buffering an unlimited upload");
  } finally { globalThis.fetch = original; }
});

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
    adminUpstreamPath(["billing", "plans"]),
    "/admin-api/v1/billing/plans"
  );
  assert.equal(
    adminUpstreamPath([
      "workspaces",
      "01900000-0000-7000-8000-000000000001",
      "subscription-grants"
    ]),
    "/admin-api/v1/workspaces/01900000-0000-7000-8000-000000000001/subscription-grants"
  );
  assert.equal(
    adminUpstreamPath(["projects"]),
    "/admin-api/v1/projects"
  );
  assert.equal(
    adminUpstreamPath(["operations"]),
    "/admin-api/v1/operations"
  );
  assert.equal(
    adminUpstreamPath(["provider-accounts", "refresh"]),
    "/admin-api/v1/provider-accounts/refresh"
  );
  assert.equal(
    adminUpstreamPath([
      "provider-accounts",
      "01900000-0000-7000-8000-000000000001",
      "enabled"
    ]),
    "/admin-api/v1/provider-accounts/01900000-0000-7000-8000-000000000001/enabled"
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
  assert.equal(
    adminUpstreamPath(["workspaces", "all", "delete"]),
    undefined
  );
  assert.equal(adminUpstreamPath(["operations", "retry"]), undefined);
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
