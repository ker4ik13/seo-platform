import assert from "node:assert/strict";
import test from "node:test";
import {
  browserApiRequest,
  BrowserApiError
} from "./browser-api.ts";

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
