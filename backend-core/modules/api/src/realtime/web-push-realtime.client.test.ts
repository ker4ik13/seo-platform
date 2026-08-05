import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { loadAppConfig } from "../config/app-config.js";
import { RealtimeClient } from "./realtime.client.js";

const actorId = "01900000-0000-7000-8000-000000000001";
const sessionFamilyId = "01900000-0000-7000-8000-000000000002";
const installationId = "01900000-0000-7000-8000-000000000003";
const keyAgreement = createECDH("prime256v1");
keyAgreement.generateKeys();
const applicationServerKey = keyAgreement
  .getPublicKey()
  .toString("base64url");

test("uses only the dedicated notification credential and session family for device reads", async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: Headers | undefined;
  let capturedRedirect: RequestInit["redirect"];
  globalThis.fetch = (async (
    _input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedHeaders = new Headers(init?.headers);
    capturedRedirect = init?.redirect;
    return response({ registration: disabledRegistration(), devices: [] });
  }) as typeof fetch;

  try {
    const state = await client().getWebPushSubscriptions(context());

    assert.equal(state.registration.status, "DISABLED");
    assert.equal(
      capturedHeaders?.get("x-internal-token"),
      "n".repeat(32)
    );
    assert.equal(capturedHeaders?.get("x-actor-id"), actorId);
    assert.equal(
      capturedHeaders?.get("x-session-family-id"),
      sessionFamilyId
    );
    assert.equal(capturedHeaders?.get("x-request-id"), "request-push-001");
    assert.equal(capturedRedirect, "error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("injects trusted actor, session and normalized metadata into an upsert", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  let capturedBody: Readonly<Record<string, unknown>> | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    capturedBody = JSON.parse(String(init?.body)) as Readonly<
      Record<string, unknown>
    >;
    return response(device());
  }) as typeof fetch;

  try {
    const result = await client().upsertWebPushSubscription(
      context(),
      installationId,
      {
        label: "Рабочий Mac",
        intent: "ENABLE",
        applicationServerKeyVersion: 1,
        subscription: {
          endpoint: "https://push.example.test/opaque",
          expirationTime: null,
          keys: {
            p256dh: applicationServerKey,
            auth: Buffer.alloc(16, 3).toString("base64url")
          }
        },
        browser: "CHROME",
        platform: "MACOS"
      }
    );

    assert.equal(result.installationId, installationId);
    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/users/${actorId}/push-subscriptions/${installationId}`
    );
    assert.equal(capturedBody?.userId, actorId);
    assert.equal(capturedBody?.sessionFamilyId, sessionFamilyId);
    assert.equal(capturedBody?.browser, "CHROME");
    assert.equal(capturedBody?.platform, "MACOS");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sends a trusted version for rename and keeps revoke idempotent", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{
    readonly method: string | undefined;
    readonly body: unknown;
  }> = [];
  globalThis.fetch = (async (
    _input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    calls.push({
      method: init?.method,
      body:
        typeof init?.body === "string"
          ? JSON.parse(init.body)
          : undefined
    });
    return init?.method === "DELETE"
      ? response({
          installationId,
          status: "REVOKED",
          revoked: false
        })
      : response({ ...device(), label: "Личный ноутбук", version: 2 });
  }) as typeof fetch;

  try {
    const api = client();
    const renamed = await api.renameWebPushDevice(
      context(),
      installationId,
      { label: "Личный ноутбук" },
      1
    );
    const revoked = await api.revokeWebPushDevice(
      context(),
      installationId
    );

    assert.equal(renamed.version, 2);
    assert.deepEqual(calls[0]?.body, {
      label: "Личный ноутбук",
      userId: actorId,
      version: 1
    });
    assert.equal(calls[1]?.method, "DELETE");
    assert.equal(calls[1]?.body, undefined);
    assert.equal(revoked.revoked, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps only finite Web Push dependency errors without echoing upstream secrets", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        code: "PUSH_SUBSCRIPTION_ALREADY_BOUND",
        message: "belongs to user@example.test",
        details: { endpoint: "https://push.example.test/secret" }
      }),
      {
        status: 409,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    await assert.rejects(
      client().getWebPushSubscriptions(context()),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 409 &&
        error.code === "PUSH_SUBSCRIPTION_ALREADY_BOUND" &&
        !error.message.includes("example.test") &&
        error.details === undefined
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves only the documented finite Web Push error catalog", async () => {
  const originalFetch = globalThis.fetch;
  let current:
    | {
        readonly status: number;
        readonly code?: string;
      }
    | undefined;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(
      JSON.stringify(
        current?.code
          ? { code: current.code, message: "upstream detail" }
          : { message: "upstream detail" }
      ),
      {
        status: current?.status ?? 500,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    const cases = [
      [401, "UNAUTHENTICATED", 401, "UNAUTHENTICATED"],
      [404, "NOT_FOUND", 404, "NOT_FOUND"],
      [409, "VERSION_CONFLICT", 412, "VERSION_CONFLICT"],
      [
        409,
        "VAPID_KEY_VERSION_CHANGED",
        409,
        "VAPID_KEY_VERSION_CHANGED"
      ],
      [
        409,
        "PUSH_DEVICE_LIMIT_REACHED",
        409,
        "PUSH_DEVICE_LIMIT_REACHED"
      ],
      [
        409,
        "EXPLICIT_ENABLE_REQUIRED",
        409,
        "EXPLICIT_ENABLE_REQUIRED"
      ],
      [
        503,
        "WEB_PUSH_UNAVAILABLE",
        503,
        "WEB_PUSH_UNAVAILABLE"
      ],
      [400, undefined, 422, "VALIDATION_FAILED"]
    ] as const;
    for (const [
      upstreamStatus,
      upstreamCode,
      expectedStatus,
      expectedCode
    ] of cases) {
      current = {
        status: upstreamStatus,
        ...(upstreamCode ? { code: upstreamCode } : {})
      };
      await assert.rejects(
        client().getWebPushSubscriptions(context()),
        (error: unknown) =>
          error instanceof DomainError &&
          error.statusCode === expectedStatus &&
          error.code === expectedCode &&
          !error.message.includes("upstream detail")
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails closed for an unknown upstream error payload", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        error: { code: "UNKNOWN", message: "secret internal state" }
      }),
      {
        status: 409,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    await assert.rejects(
      client().getWebPushSubscriptions(context()),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 503 &&
        error.code === "DEPENDENCY_UNAVAILABLE"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects unknown owner envelope fields and contradictory entity versions", async () => {
  const originalFetch = globalThis.fetch;
  let unsafeEnvelope: unknown = {
    data: { registration: disabledRegistration(), devices: [] },
    meta: { requestId: "owner-request-001" },
    endpoint: "https://push.example.test/secret"
  };
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(JSON.stringify(unsafeEnvelope), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

  try {
    await assert.rejects(
      client().getWebPushSubscriptions(context()),
      (error: unknown) =>
        error instanceof DomainError && error.statusCode === 502
    );
    unsafeEnvelope = {
      data: device(),
      meta: { requestId: "owner-request-002", version: 2 }
    };
    await assert.rejects(
      client().upsertWebPushSubscription(
        context(),
        installationId,
        {
          label: "Рабочий Mac",
          intent: "ENABLE",
          applicationServerKeyVersion: 1,
          subscription: {
            endpoint: "https://push.example.test/opaque",
            expirationTime: null,
            keys: {
              p256dh: applicationServerKey,
              auth: Buffer.alloc(16, 3).toString("base64url")
            }
          },
          browser: "CHROME",
          platform: "MACOS"
        }
      ),
      (error: unknown) =>
        error instanceof DomainError && error.statusCode === 502
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not fall back to the shared credential when push auth is absent", async () => {
  const api = new RealtimeClient(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      PLATFORM_API_TO_REALTIME_TOKEN: "i".repeat(32),
      REALTIME_INTERNAL_URL: "http://realtime.test:4003"
    })
  );

  await assert.rejects(
    api.getWebPushSubscriptions(context()),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "WEB_PUSH_UNAVAILABLE"
  );
});

function context() {
  return {
    actorId,
    sessionFamilyId,
    requestId: "request-push-001"
  };
}

function client(): RealtimeClient {
  return new RealtimeClient(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      PLATFORM_API_TO_REALTIME_TOKEN: "i".repeat(32),
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32),
      PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN: "n".repeat(32),
      REALTIME_INTERNAL_URL: "http://realtime.test:4003"
    })
  );
}

function response(data: unknown): Response {
  const version =
    typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    "version" in data &&
    Number.isSafeInteger(data.version)
      ? Number(data.version)
      : undefined;
  return new Response(
    JSON.stringify({
      data,
      meta: {
        requestId: "owner-request-001",
        ...(version === undefined ? {} : { version })
      }
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );
}

function disabledRegistration() {
  return {
    status: "DISABLED",
    reason: "SERVER_NOT_CONFIGURED",
    maxActiveDevices: 20,
    deliveryAvailable: false,
    testDeliveryAvailable: false
  };
}

function device() {
  return {
    installationId,
    label: "Рабочий Mac",
    status: "ACTIVE",
    browser: "CHROME",
    platform: "MACOS",
    applicationServerKeyVersion: 1,
    lastDeliveryStatus: "NEVER",
    createdAt: "2026-07-29T10:00:00.000Z",
    updatedAt: "2026-07-29T10:00:00.000Z",
    version: 1
  };
}
