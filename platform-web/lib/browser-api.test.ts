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
