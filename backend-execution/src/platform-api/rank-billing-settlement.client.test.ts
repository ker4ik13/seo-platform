import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import {
  RankBillingSettlementClient,
  RankBillingSettlementClientError
} from "./rank-billing-settlement.client.js";

const ids = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  grantId: "01900000-0000-7000-8000-000000000004"
} as const;

const command = ids;
const context = {
  requestId: "rank-settle-01900000-0000-7000-8000-000000000005",
  idempotencyKey:
    "rank-settlement:01900000-0000-7000-8000-000000000004:capture"
} as const;

const config = {
  rankBillingSettlementApiToken: "billing-settlement-secret",
  platformApiCommandTimeoutMs: 2_500,
  services: { platformApi: "http://backend-core:4000" }
} as AppConfig;

test("captures through only the dedicated settlement boundary", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let headers: Headers | undefined;
  let body: unknown;
  globalThis.fetch = (async (request, init) => {
    requestUrl = String(request);
    headers = new Headers(init?.headers);
    body = JSON.parse(String(init?.body));
    return resultResponse("CAPTURED");
  }) as typeof fetch;

  try {
    const result = await new RankBillingSettlementClient(config).capture(
      command,
      context
    );
    assert.equal(result.status, "CAPTURED");
    assert.equal(
      requestUrl,
      `http://backend-core:4000/internal/v1/workspaces/${ids.workspaceId}/projects/${ids.projectId}/rank-execution-grants/${ids.grantId}/settlements`
    );
    assert.equal(
      headers?.get("X-Rank-Billing-Settlement-Token"),
      "billing-settlement-secret"
    );
    assert.equal(headers?.get("X-Rank-Grant-Token"), null);
    assert.equal(headers?.get("X-Workspace-Id"), ids.workspaceId);
    assert.equal(headers?.get("X-Project-Id"), ids.projectId);
    assert.equal(headers?.get("X-Actor-Id"), ids.actorId);
    assert.equal(headers?.get("X-Request-Id"), context.requestId);
    assert.equal(
      headers?.get("Idempotency-Key"),
      context.idempotencyKey
    );
    assert.deepEqual(body, {
      schemaVersion: "rank-execution-grant-settlement-request@1",
      action: "CAPTURE"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("holds a live reservation without accepting an inapplicable result", async () => {
  const originalFetch = globalThis.fetch;
  let body: unknown;
  globalThis.fetch = (async (_request, init) => {
    body = JSON.parse(String(init?.body));
    return resultResponse("RESERVED");
  }) as typeof fetch;
  try {
    const result = await new RankBillingSettlementClient(config).hold(
      command,
      {
        ...context,
        idempotencyKey:
          `rank-settlement:${ids.grantId}:hold`
      }
    );
    assert.equal(result.status, "RESERVED");
    assert.deepEqual(body, {
      schemaVersion: "rank-execution-grant-settlement-request@1",
      action: "HOLD"
    });

    globalThis.fetch = (async () =>
      resultResponse("NOT_APPLICABLE")) as typeof fetch;
    await assert.rejects(
      new RankBillingSettlementClient(config).hold(command, context),
      invalidResponse
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a mismatched, inapplicable or cacheable settlement response", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const response of [
      resultResponse("NOT_APPLICABLE"),
      jsonResponse({
        data: {
          schemaVersion: "rank-execution-grant-settlement-result@1",
          grantId: "01900000-0000-7000-8000-000000000099",
          status: "CAPTURED"
        },
        meta: { requestId: context.requestId }
      }),
      Response.json({
        data: settlementResult("CAPTURED"),
        meta: { requestId: context.requestId }
      })
    ]) {
      globalThis.fetch = (async () => response) as typeof fetch;
      await assert.rejects(
        new RankBillingSettlementClient(config).capture(command, context),
        invalidResponse
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps transport failures retryable and expiry finite", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(null, { status: 503 })) as typeof fetch;
    await assert.rejects(
      new RankBillingSettlementClient(config).capture(command, context),
      (error: unknown) =>
        error instanceof RankBillingSettlementClientError &&
        error.code === "UNAVAILABLE" &&
        error.retryable
    );

    globalThis.fetch = (async () =>
      jsonResponse({ error: { code: "RESERVATION_EXPIRED" } }, 409)) as typeof fetch;
    await assert.rejects(
      new RankBillingSettlementClient(config).capture(command, context),
      (error: unknown) =>
        error instanceof RankBillingSettlementClientError &&
        error.code === "RESERVATION_EXPIRED" &&
        !error.retryable
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects malformed local scope and an absent token before fetch", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("must not fetch");
  }) as typeof fetch;
  try {
    const { rankBillingSettlementApiToken: _token, ...withoutToken } =
      config;
    await assert.rejects(
      new RankBillingSettlementClient(config).capture(
        { ...command, actorId: "not-a-uuid" },
        context
      ),
      (error: unknown) =>
        error instanceof RankBillingSettlementClientError &&
        error.code === "INVALID_REQUEST" &&
        !error.retryable
    );
    await assert.rejects(
      new RankBillingSettlementClient(
        withoutToken as AppConfig
      ).capture(command, context),
      (error: unknown) =>
        error instanceof RankBillingSettlementClientError &&
        error.code === "UNAVAILABLE" &&
        !error.retryable
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function settlementResult(
  status: "RESERVED" | "CAPTURED" | "NOT_APPLICABLE"
) {
  return {
    schemaVersion: "rank-execution-grant-settlement-result@1" as const,
    grantId: ids.grantId,
    status
  };
}

function resultResponse(
  status: "RESERVED" | "CAPTURED" | "NOT_APPLICABLE"
): Response {
  return jsonResponse({
    data: settlementResult(status),
    meta: { requestId: context.requestId }
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "private, no-store" }
  });
}

function invalidResponse(error: unknown): boolean {
  return (
    error instanceof RankBillingSettlementClientError &&
    error.code === "INVALID_RESPONSE" &&
    !error.retryable
  );
}
