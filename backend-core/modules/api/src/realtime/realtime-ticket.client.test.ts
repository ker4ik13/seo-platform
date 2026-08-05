import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  realtimeAuthorizationLeaseMilliseconds,
  realtimeTicketRequestSchemaVersion,
  realtimeTicketTtlMilliseconds
} from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";
import { loadAppConfig } from "../config/app-config.js";
import { RealtimeClient } from "./realtime.client.js";

const USER_ID = "0198f258-8cc7-7abc-8def-1234567890ab";
const SESSION_ID = "0198f258-8cc7-7abc-8def-1234567890ac";
const FAMILY_ID = "0198f258-8cc7-7abc-8def-1234567890ad";
const WORKSPACE_ID = "0198f258-8cc7-7abc-8def-1234567890ae";
const PROJECT_ID = "0198f258-8cc7-7abc-8def-1234567890af";
const MEMBERSHIP_ID = "0198f258-8cc7-7abc-8def-1234567890b0";
const CLIENT_ID = "0198f258-8cc7-7abc-8def-1234567890b1";

test("uses the existing dedicated credential and injects the full trusted snapshot", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  let capturedHeaders: Headers | undefined;
  let capturedBody: unknown;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    capturedHeaders = new Headers(init?.headers);
    capturedBody = JSON.parse(String(init?.body));
    return ticketResponse();
  }) as typeof fetch;

  try {
    const result = await client().issueProjectTicket(
      projectContext(),
      sessionContext(),
      { clientInstanceId: CLIENT_ID },
      "https://app.example.test"
    );

    assert.equal(result.namespace, "/collaboration");
    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/projects/${PROJECT_ID}/realtime-tickets`
    );
    assert.equal(capturedHeaders?.get("x-internal-token"), "r".repeat(32));
    assert.equal(capturedHeaders?.get("x-actor-id"), USER_ID);
    assert.equal(capturedHeaders?.get("x-workspace-id"), WORKSPACE_ID);
    assert.equal(capturedHeaders?.get("x-project-id"), PROJECT_ID);
    assert.equal(capturedHeaders?.get("x-membership-id"), MEMBERSHIP_ID);
    assert.equal(capturedHeaders?.get("x-membership-version"), "4");
    assert.deepEqual(capturedBody, {
      schemaVersion: realtimeTicketRequestSchemaVersion,
      userId: USER_ID,
      sessionId: SESSION_ID,
      sessionFamilyId: FAMILY_ID,
      sessionExpiresAt: "2026-08-30T12:00:00.000Z",
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      membershipId: MEMBERSHIP_ID,
      membershipVersion: 4,
      clientInstanceId: CLIENT_ID,
      origin: "https://app.example.test"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails closed for revoked sessions and malformed owner responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (): Promise<Response> =>
      new Response("{}", {
        status: 401,
        headers: { "content-type": "application/json" }
      })) as typeof fetch;
    await assert.rejects(
      client().issueProjectTicket(
        projectContext(),
        sessionContext(),
        { clientInstanceId: CLIENT_ID },
        "https://app.example.test"
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 401 &&
        error.code === "UNAUTHENTICATED"
    );

    globalThis.fetch = (async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          data: { ...ticketData(), ticket: "not-a-ticket" },
          meta: { requestId: "owner-request-001" }
        }),
        {
          status: 201,
          headers: { "content-type": "application/json" }
        }
      )) as typeof fetch;
    await assert.rejects(
      client().issueProjectTicket(
        projectContext(),
        sessionContext(),
        { clientInstanceId: CLIENT_ID },
        "https://app.example.test"
      ),
      (error: unknown) =>
        error instanceof DomainError && error.statusCode === 502
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps ticket transport failures to the realtime dependency", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> => {
    throw new TypeError("network unavailable");
  }) as typeof fetch;

  try {
    await assert.rejects(
      client().issueProjectTicket(
        projectContext(),
        sessionContext(),
        { clientInstanceId: CLIENT_ID },
        "https://app.example.test"
      ),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 503 &&
        error.code === "DEPENDENCY_UNAVAILABLE" &&
        error.message ===
          "Realtime authorization is temporarily unavailable"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function client(): RealtimeClient {
  return new RealtimeClient(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      PLATFORM_API_TO_REALTIME_TOKEN: "r".repeat(32),
      REALTIME_INTERNAL_URL: "http://realtime.test:4003"
    })
  );
}

function projectContext() {
  return {
    actorId: USER_ID,
    requestId: "request-realtime-001",
    tenant: {
      workspaceId: WORKSPACE_ID,
      workspaceStatus: "ACTIVE" as const,
      projectId: PROJECT_ID,
      projectStatus: "ACTIVE" as const,
      roleCode: "SEO_SPECIALIST",
      membershipId: MEMBERSHIP_ID,
      membershipVersion: 4
    }
  };
}

function sessionContext() {
  return {
    sessionId: SESSION_ID,
    sessionFamilyId: FAMILY_ID,
    sessionExpiresAt: "2026-08-30T12:00:00.000Z"
  };
}

function ticketResponse(): Response {
  return new Response(
    JSON.stringify({
      data: ticketData(),
      meta: { requestId: "owner-request-001" }
    }),
    {
      status: 201,
      headers: { "content-type": "application/json" }
    }
  );
}

function ticketData() {
  const issuedAt = new Date("2026-07-30T12:00:00.000Z");
  return {
    ticket: randomBytes(32).toString("base64url"),
    namespace: "/collaboration",
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(
      issuedAt.getTime() + realtimeTicketTtlMilliseconds
    ).toISOString(),
    authorizationExpiresAt: new Date(
      issuedAt.getTime() + realtimeAuthorizationLeaseMilliseconds
    ).toISOString()
  };
}
