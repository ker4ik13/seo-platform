import assert from "node:assert/strict";
import test from "node:test";
import {
  browserApiRequest,
  BrowserApiError
} from "./browser-api.ts";

test("refreshes an expired session once and retries the API request", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let apiCalls = 0;
  let refreshCalls = 0;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { cookie: "seo_csrf=public-csrf" }
  });
  globalThis.fetch = async (input, init) => {
    if (input === "/app/auth/refresh") {
      refreshCalls += 1;
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init.headers).get("x-csrf-token"), "public-csrf");
      return Response.json({ data: { refreshed: true } });
    }
    apiCalls += 1;
    if (apiCalls === 1) {
      return Response.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
        { status: 401 }
      );
    }
    return Response.json({ data: { ready: true } });
  };

  try {
    assert.deepEqual(
      await browserApiRequest("/app/api/projects/project-id/integration-settings"),
      { ready: true }
    );
    assert.equal(apiCalls, 2);
    assert.equal(refreshCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreGlobalDocument(originalDocument);
  }
});

test("coalesces concurrent 401 responses into one refresh rotation", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  let apiCalls = 0;
  let refreshCalls = 0;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { cookie: "seo_csrf=public-csrf" }
  });
  globalThis.fetch = async (input) => {
    if (input === "/app/auth/refresh") {
      refreshCalls += 1;
      await Promise.resolve();
      return Response.json({ data: { refreshed: true } });
    }
    apiCalls += 1;
    if (apiCalls <= 2) {
      return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
    }
    return Response.json({ data: { ready: true } });
  };

  try {
    await Promise.all([
      browserApiRequest("/app/api/notifications"),
      browserApiRequest("/app/api/projects/project-id/integration-settings")
    ]);
    assert.equal(apiCalls, 4);
    assert.equal(refreshCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreGlobalDocument(originalDocument);
  }
});

test("preserves request metadata from a standard API error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "DEPENDENCY_UNAVAILABLE",
          message: "Temporary failure",
          requestId: "request-from-body",
          retryable: true,
          fieldErrors: [
            {
              path: "route.credentialId",
              code: "CREDENTIAL_UNAVAILABLE"
            }
          ]
        }
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "request-from-header"
        }
      }
    );

  try {
    await assert.rejects(
      browserApiRequest("/app/api/projects/project-id/integration-settings"),
      (error: unknown) => {
        assert.ok(error instanceof BrowserApiError);
        assert.equal(error.status, 503);
        assert.equal(error.code, "DEPENDENCY_UNAVAILABLE");
        assert.equal(error.requestId, "request-from-body");
        assert.equal(error.retryable, true);
        assert.deepEqual(error.fieldErrors, [
          {
            path: "route.credentialId",
            code: "CREDENTIAL_UNAVAILABLE"
          }
        ]);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("projects only exact allowlisted public conflict details", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [details, expectedReason, expectedJobId] of [
      [
        {
          reason: "EQUIVALENT_RUN_ACTIVE",
          existingJobId: "01900000-0000-7000-8000-000000000004"
        },
        "EQUIVALENT_RUN_ACTIVE",
        "01900000-0000-7000-8000-000000000004"
      ],
      [{ reason: "ESTIMATE_EXPIRED" }, "ESTIMATE_EXPIRED", undefined],
      [
        {
          reason: "EQUIVALENT_RUN_ACTIVE",
          existingJobId: "01900000-0000-7000-8000-000000000004",
          privateDiagnostic: "must-not-be-projected"
        },
        undefined,
        undefined
      ],
      [{ reason: "PRIVATE_UPSTREAM_REASON" }, undefined, undefined]
    ] as const) {
      globalThis.fetch = async () =>
        Response.json(
          {
            error: {
              code: "RESOURCE_STATE_CONFLICT",
              message: "Conflict",
              details
            }
          },
          { status: 409 }
        );

      await assert.rejects(
        browserApiRequest("/app/api/projects/project-id/rank-runs"),
        (error: unknown) => {
          assert.ok(error instanceof BrowserApiError);
          assert.equal(error.reason, expectedReason);
          assert.equal(error.existingJobId, expectedJobId);
          assert.equal("details" in error, false);
          assert.equal("privateDiagnostic" in error, false);
          return true;
        }
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back to the response request id and status retryability", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("not-json", {
      status: 502,
      headers: { "X-Request-Id": "request-from-header" }
    });

  try {
    await assert.rejects(
      browserApiRequest("/app/api/projects/project-id/integration-settings"),
      (error: unknown) => {
        assert.ok(error instanceof BrowserApiError);
        assert.equal(error.requestId, "request-from-header");
        assert.equal(error.retryable, true);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards PUT for naturally idempotent resource assignment", async () => {
  const originalFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    request = init;
    return Response.json({
      data: {
        contextId: "context-id",
        keywordId: "keyword-id",
        assigned: true
      }
    });
  };

  try {
    await browserApiRequest(
      "/app/api/projects/project-id/tracking-contexts/context-id/keywords/keyword-id",
      {
        method: "PUT"
      }
    );
    assert.equal(request?.method, "PUT");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sends session revoke through same-origin BFF with only the public CSRF value", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );
  const originalCookieName =
    process.env.NEXT_PUBLIC_AUTH_CSRF_COOKIE_NAME;
  let target: string | URL | Request | undefined;
  let request: RequestInit | undefined;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      cookie:
        "custom_csrf=public-csrf-value; seo_session=must-not-be-copied"
    }
  });
  process.env.NEXT_PUBLIC_AUTH_CSRF_COOKIE_NAME = "custom_csrf";
  globalThis.fetch = async (input, init) => {
    target = input;
    request = init;
    return new Response(null, { status: 204 });
  };

  try {
    await browserApiRequest<void>(
      "/app/api/sessions/01900000-0000-7000-8000-000000000001",
      { method: "DELETE" }
    );
    assert.equal(
      target,
      "/app/api/sessions/01900000-0000-7000-8000-000000000001"
    );
    assert.equal(request?.method, "DELETE");
    assert.equal(request?.credentials, "same-origin");
    assert.equal(request?.cache, "no-store");
    const headers = new Headers(request?.headers);
    assert.equal(headers.get("x-csrf-token"), "public-csrf-value");
    assert.equal(headers.get("cookie"), null);
    assert.equal(headers.get("authorization"), null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
    if (originalCookieName === undefined) {
      delete process.env.NEXT_PUBLIC_AUTH_CSRF_COOKIE_NAME;
    } else {
      process.env.NEXT_PUBLIC_AUTH_CSRF_COOKIE_NAME = originalCookieName;
    }
  }
});

test("queues an audited semantic export through the same-origin BFF", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );
  let request: RequestInit | undefined;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { cookie: "seo_csrf=public-csrf" }
  });
  globalThis.fetch = async (_input, init) => {
    request = init;
    return Response.json({ data: { id: "export-id", status: "QUEUED" } }, {
      status: 202
    });
  };

  try {
    const result = await browserApiRequest<{
      readonly id: string;
      readonly status: string;
    }>(
      "/app/api/projects/project-id/exports",
      {
        method: "POST",
        idempotencyKey: "semantic-export:test-key",
        body: {
          format: "CSV",
          scope: "FULL_CORE",
          locale: "en",
          columns: ["query"]
        }
      }
    );
    assert.deepEqual(result, { id: "export-id", status: "QUEUED" });
    assert.equal(request?.method, "POST");
    const headers = new Headers(request?.headers);
    assert.equal(headers.get("x-csrf-token"), "public-csrf");
    assert.equal(headers.get("idempotency-key"), "semantic-export:test-key");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDocument) {
      Object.defineProperty(globalThis, "document", originalDocument);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  }
});

function restoreGlobalDocument(
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, "document", descriptor);
  } else {
    Reflect.deleteProperty(globalThis, "document");
  }
}
