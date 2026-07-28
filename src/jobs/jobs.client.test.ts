import assert from "node:assert/strict";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import { JobsClient } from "./jobs.client.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const actorId = "01900000-0000-7000-8000-000000000002";
const credentialId = "01900000-0000-7000-8000-000000000003";

test("forwards a credential idempotency key with trusted workspace context", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Readonly<Record<string, unknown>> | undefined;
  let capturedHeaders: Headers | undefined;
  globalThis.fetch = (async (
    _input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedHeaders = new Headers(init?.headers);
    assert.equal(typeof init?.body, "string");
    capturedBody = JSON.parse(String(init?.body)) as Readonly<
      Record<string, unknown>
    >;
    return new Response(
      JSON.stringify({
        data: {
          id: credentialId,
          workspaceId,
          provider: "KEYS_SO",
          label: "Primary",
          mode: "BYOK_API_KEY",
          status: "PENDING_VERIFICATION",
          displayHint: "••••-key",
          capabilities: [
            "KEYWORD_RESEARCH",
            "COMPETITOR_RESEARCH",
            "SERP_COLLECTION"
          ],
          version: 1,
          createdAt: "2026-07-29T09:00:00.000Z",
          updatedAt: "2026-07-29T09:00:00.000Z"
        }
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  }) as typeof fetch;

  try {
    const client = new JobsClient(
      loadAppConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://test",
        INTERNAL_API_TOKEN: "i".repeat(32),
        PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32),
        JOBS_INTERNAL_URL: "http://jobs.test:4002"
      })
    );
    const result = await client.createIntegrationCredential(
      {
        tenant: { workspaceId, roleCode: "OWNER" },
        actorId,
        requestId: "request-jobs-001"
      },
      {
        provider: "KEYS_SO",
        label: "Primary",
        apiKey: "test-api-key"
      },
      "credential-create-001"
    );

    assert.equal(result.id, credentialId);
    assert.equal(capturedBody?.workspaceId, workspaceId);
    assert.equal(capturedBody?.actorId, actorId);
    assert.equal(
      capturedBody?.idempotencyKey,
      "credential-create-001"
    );
    assert.equal(capturedHeaders?.get("x-workspace-id"), workspaceId);
    assert.equal(capturedHeaders?.get("x-project-id"), null);
    assert.equal(
      capturedHeaders?.get("x-internal-token"),
      "c".repeat(32)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
