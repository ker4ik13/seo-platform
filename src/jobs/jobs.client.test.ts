import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { loadAppConfig } from "../config/app-config.js";
import { JobsClient } from "./jobs.client.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const actorId = "01900000-0000-7000-8000-000000000002";
const credentialId = "01900000-0000-7000-8000-000000000003";
const validationId = "01900000-0000-7000-8000-000000000004";

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

test("preserves the authoritative current-material active validation in the credential list", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        data: [
          {
            ...credentialResponseData(),
            activeValidation: validationResponseData("RUNNING", {
              startedAt: "2026-07-29T09:00:01.000Z"
            })
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    const result = await client().listIntegrationCredentials(
      context("request-credential-list-001")
    );

    assert.equal(result[0]?.activeValidation?.id, validationId);
    assert.equal(result[0]?.activeValidation?.status, "RUNNING");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a credential list validation outside the credential scope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        data: [
          {
            ...credentialResponseData(),
            activeValidation: validationResponseData("QUEUED", {
              credentialId:
                "01900000-0000-7000-8000-000000000099"
            })
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    await assert.rejects(
      client().listIntegrationCredentials(
        context("request-credential-list-002")
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 502 &&
        error.code === "DEPENDENCY_UNAVAILABLE"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a terminal job exposed as an active credential validation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        data: [
          {
            ...credentialResponseData(),
            activeValidation: validationResponseData("SUCCEEDED", {
              finishedAt: "2026-07-29T09:00:02.000Z"
            })
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    await assert.rejects(
      client().listIntegrationCredentials(
        context("request-credential-list-003")
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 502 &&
        error.code === "DEPENDENCY_UNAVAILABLE"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("creates a credential validation with an idempotent trusted command", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  let capturedMethod: string | undefined;
  let capturedBody: Readonly<Record<string, unknown>> | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    capturedMethod = init?.method;
    assert.equal(typeof init?.body, "string");
    capturedBody = JSON.parse(String(init?.body)) as Readonly<
      Record<string, unknown>
    >;
    return validationResponse("QUEUED");
  }) as typeof fetch;

  try {
    const result =
      await client().createIntegrationCredentialValidation(
        context("request-validation-create-001"),
        credentialId,
        "credential-validation-001"
      );

    assert.equal(result.id, validationId);
    assert.equal(result.status, "QUEUED");
    assert.equal(capturedMethod, "POST");
    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/workspaces/${workspaceId}/integrations/credentials/${credentialId}/validations`
    );
    assert.deepEqual(capturedBody, {
      workspaceId,
      actorId,
      idempotencyKey: "credential-validation-001"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("gets and validates a credential validation response", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  let capturedMethod: string | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    capturedMethod = init?.method;
    return validationResponse("SUCCEEDED", {
      startedAt: "2026-07-29T09:00:01.000Z",
      finishedAt: "2026-07-29T09:00:02.000Z"
    });
  }) as typeof fetch;

  try {
    const result = await client().getIntegrationCredentialValidation(
      context("request-validation-get-001"),
      credentialId,
      validationId
    );

    assert.equal(result.status, "SUCCEEDED");
    assert.equal(result.finishedAt, "2026-07-29T09:00:02.000Z");
    assert.equal(capturedMethod, "GET");
    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/workspaces/${workspaceId}/integrations/credentials/${credentialId}/validations/${validationId}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves the scheduled retry time for a nonterminal validation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    validationResponse("RETRY_SCHEDULED", {
      startedAt: "2026-07-29T09:00:01.000Z",
      retryAt: "2026-07-29T09:00:06.000Z"
    })) as typeof fetch;

  try {
    const result = await client().getIntegrationCredentialValidation(
      context("request-validation-retry-001"),
      credentialId,
      validationId
    );

    assert.equal(result.status, "RETRY_SCHEDULED");
    assert.equal(result.retryAt, "2026-07-29T09:00:06.000Z");
    assert.equal(result.finishedAt, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an invalid credential validation response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    validationResponse("UNKNOWN")) as typeof fetch;

  try {
    await assert.rejects(
      client().getIntegrationCredentialValidation(
        context("request-validation-get-002"),
        credentialId,
        validationId
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 502 &&
        error.code === "DEPENDENCY_UNAVAILABLE"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a credential validation outside the trusted scope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    validationResponse("QUEUED", {
      workspaceId: "01900000-0000-7000-8000-000000000099"
    })) as typeof fetch;

  try {
    await assert.rejects(
      client().getIntegrationCredentialValidation(
        context("request-validation-get-003"),
        credentialId,
        validationId
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 502 &&
        error.code === "DEPENDENCY_UNAVAILABLE"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function client(): JobsClient {
  return new JobsClient(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      INTERNAL_API_TOKEN: "i".repeat(32),
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32),
      JOBS_INTERNAL_URL: "http://jobs.test:4002"
    })
  );
}

function context(requestId: string): {
  readonly tenant: {
    readonly workspaceId: string;
    readonly roleCode: "OWNER";
  };
  readonly actorId: string;
  readonly requestId: string;
} {
  return {
    tenant: { workspaceId, roleCode: "OWNER" },
    actorId,
    requestId
  };
}

function validationResponse(
  status: string,
  overrides: Readonly<Record<string, unknown>> = {}
): Response {
  return new Response(
    JSON.stringify({
      data: validationResponseData(status, overrides)
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );
}

function validationResponseData(
  status: string,
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  return {
    id: validationId,
    workspaceId,
    credentialId,
    credentialMaterialVersion: 1,
    provider: "KEYS_SO",
    status,
    connectorVersion: "1.0.0",
    requestedAt: "2026-07-29T09:00:00.000Z",
    ...overrides
  };
}

function credentialResponseData(): Readonly<Record<string, unknown>> {
  return {
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
  };
}
