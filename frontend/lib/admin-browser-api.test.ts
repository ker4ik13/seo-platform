import assert from "node:assert/strict";
import test from "node:test";
import { adminApi } from "./admin-browser-api.ts";

test("refreshes an expired admin access session and retries without another login", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  let cookie = "seo_csrf=csrf-before";
  const calls: { url: string; init?: RequestInit }[] = [];
  let protectedCalls = 0;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { get cookie() { return cookie; } }
  });
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = String(input);
    calls.push({ url, ...(init ? { init } : {}) });
    if (url === "/admin/api/auth/refresh") {
      cookie = "seo_csrf=csrf-after";
      return jsonResponse(200, { data: { refreshed: true } });
    }
    protectedCalls += 1;
    return protectedCalls === 1
      ? jsonResponse(401, { error: { code: "UNAUTHENTICATED" } })
      : jsonResponse(200, { data: { id: "admin-user" } });
  }) as typeof fetch;

  try {
    const result = await adminApi<{ readonly id: string }>("/api/me");
    assert.deepEqual(result, { ok: true, data: { id: "admin-user" } });
    assert.deepEqual(calls.map(({ url }) => url), [
      "/admin/api/me",
      "/admin/api/auth/refresh",
      "/admin/api/me"
    ]);
    assert.equal(
      new Headers(calls[1]?.init?.headers).get("x-csrf-token"),
      "csrf-before"
    );
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument
    });
  }
});

test("retries an admin command with the rotated CSRF token", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  let cookie = "seo_csrf=command-before";
  const calls: { url: string; init?: RequestInit }[] = [];
  let protectedCalls = 0;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { get cookie() { return cookie; } }
  });
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = String(input);
    calls.push({ url, ...(init ? { init } : {}) });
    if (url === "/admin/api/auth/refresh") {
      cookie = "seo_csrf=command-after";
      return jsonResponse(200, { data: { refreshed: true } });
    }
    protectedCalls += 1;
    return protectedCalls === 1
      ? jsonResponse(401, { error: { code: "UNAUTHENTICATED" } })
      : jsonResponse(200, { data: { updated: true } });
  }) as typeof fetch;

  try {
    const result = await adminApi<{ readonly updated: boolean }>(
      "/api/staff/role",
      {
        method: "POST",
        headers: { "X-CSRF-Token": "command-before" },
        body: "{}"
      }
    );
    assert.deepEqual(result, { ok: true, data: { updated: true } });
    assert.equal(
      new Headers(calls[2]?.init?.headers).get("x-csrf-token"),
      "command-after"
    );
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument
    });
  }
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
