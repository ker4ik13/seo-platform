import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_EMAIL_COMPLETION_RECEIPT_SCHEMA,
  AUTH_EMAIL_MATERIAL_DECISION_SCHEMA,
  transactionalEmailEventTypesV1
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import {
  AuthEmailMaterialClient,
  AuthEmailMaterialClientError
} from "./auth-email-material.client.js";

const eventId = "01900000-0000-7000-8000-000000000001";
const requestId = `auth-email-material-${eventId}`;
const config = {
  authEmailApiToken: "dedicated-auth-email-token",
  platformApiCommandTimeoutMs: 2_500,
  services: {
    platformApi: "http://backend-core:4000",
    seoData: "http://seo-data:4001"
  }
} as AppConfig;

test("fetches JIT material through only the dedicated bearer boundary", async () => {
  const originalFetch = globalThis.fetch;
  let observedUrl = "";
  let observedHeaders = new Headers();
  let observedBody: unknown;
  globalThis.fetch = (async (request, init) => {
    observedUrl = String(request);
    observedHeaders = new Headers(init?.headers);
    observedBody = JSON.parse(String(init?.body));
    return envelopeResponse(readyMaterial(), requestId);
  }) as typeof fetch;

  try {
    const material = await new AuthEmailMaterialClient(config).material(
      eventId,
      transactionalEmailEventTypesV1.emailVerificationRequested
    );
    assert.equal(material.decision, "READY");
    assert.equal(
      observedUrl,
      `http://backend-core:4000/internal/v1/auth-email-deliveries/${eventId}/material`
    );
    assert.equal(
      observedHeaders.get("authorization"),
      "Bearer dedicated-auth-email-token"
    );
    assert.equal(observedHeaders.get("x-request-id"), requestId);
    assert.equal(observedHeaders.get("x-internal-token"), null);
    assert.deepEqual(observedBody, {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("posts completion outcomes only as the exact shared receipt contract", async () => {
  const originalFetch = globalThis.fetch;
  let observedBody: unknown;
  globalThis.fetch = (async (_request, init) => {
    observedBody = JSON.parse(String(init?.body));
    return envelopeResponse(
      {
        schemaVersion: AUTH_EMAIL_COMPLETION_RECEIPT_SCHEMA,
        eventId,
        outcome: "BOUNCED"
      },
      `auth-email-complete-${eventId}`
    );
  }) as typeof fetch;

  try {
    const receipt = await new AuthEmailMaterialClient(config).complete(
      eventId,
      "BOUNCED"
    );
    assert.equal(receipt.eventId, eventId);
    assert.deepEqual(observedBody, {
      schemaVersion: "auth-email-completion@1",
      eventId,
      outcome: "BOUNCED"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects extensible, mismatched and cacheable Platform responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const response of [
      envelopeResponse({ ...readyMaterial(), eventId: "01900000-0000-7000-8000-000000000002" }, requestId),
      envelopeResponse(readyMaterial(), requestId, { cacheControl: "private" }),
      envelopeResponse(readyMaterial(), requestId, { extra: true })
    ]) {
      globalThis.fetch = (async () => response) as typeof fetch;
      await assert.rejects(
        () =>
          new AuthEmailMaterialClient(config).material(
            eventId,
            transactionalEmailEventTypesV1.emailVerificationRequested
          ),
        isClientError("PLATFORM_INVALID_RESPONSE", false)
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps proxy failures retryable and auth failures terminal", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [status, code, retryable] of [
      [503, "PLATFORM_UNAVAILABLE", true],
      [429, "PLATFORM_UNAVAILABLE", true],
      [401, "PLATFORM_AUTH_FAILED", false],
      [409, "PLATFORM_REJECTED", false]
    ] as const) {
      globalThis.fetch = (async () => new Response(null, { status })) as typeof fetch;
      await assert.rejects(
        () =>
          new AuthEmailMaterialClient(config).material(
            eventId,
            transactionalEmailEventTypesV1.emailVerificationRequested
          ),
        isClientError(code, retryable)
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function readyMaterial() {
  return {
    schemaVersion: AUTH_EMAIL_MATERIAL_DECISION_SCHEMA,
    decision: "READY",
    eventId,
    eventType: transactionalEmailEventTypesV1.emailVerificationRequested,
    recipient: "person@example.test",
    locale: "ru",
    expiresAt: "2026-08-01T12:00:00.000Z",
    actionUrl: "https://app.example.test/verify#token=one_time~token"
  } as const;
}

function envelopeResponse(
  data: unknown,
  responseRequestId: string,
  options: { readonly cacheControl?: string; readonly extra?: boolean } = {}
): Response {
  return new Response(
    JSON.stringify({
      data,
      meta: { requestId: responseRequestId },
      ...(options.extra ? { diagnostics: {} } : {})
    }),
    {
      status: 200,
      headers: {
        "cache-control": options.cacheControl ?? "no-store",
        "content-type": "application/json"
      }
    }
  );
}

function isClientError(code: string, retryable: boolean) {
  return (error: unknown): boolean =>
    error instanceof AuthEmailMaterialClientError &&
    error.code === code &&
    error.retryable === retryable;
}
