import assert from "node:assert/strict";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import { JobsClient } from "./jobs.client.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const contextId = "01900000-0000-7000-8000-000000000004";

test("forwards rank estimate through the dedicated credential boundary", async () => {
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
    return new Response(JSON.stringify({ data: estimateResponse() }), {
      status: 201,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const result = await client().createRankEstimate(
      context(),
      internalInput(),
      "rank-estimate-001"
    );

    assert.equal(result.trackingContextId, contextId);
    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/workspaces/${workspaceId}/projects/${projectId}/rank-estimates`
    );
    assert.equal(capturedHeaders?.get("x-workspace-id"), workspaceId);
    assert.equal(capturedHeaders?.get("x-project-id"), projectId);
    assert.equal(capturedHeaders?.get("x-actor-id"), actorId);
    assert.equal(
      capturedHeaders?.get("x-internal-token"),
      "c".repeat(32)
    );
    assert.equal(
      capturedHeaders?.get("idempotency-key"),
      "rank-estimate-001"
    );
    assert.deepEqual(capturedBody, internalInput());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quotes a platform Arsenkin batch per keyword", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request): Promise<Response> =>
    new Response(
      JSON.stringify({
        data: String(input).endsWith("/pricing-scope") ? {
          estimateId: estimateResponse().id, workspaceId, projectId, actorId,
          provider: "ARSENKIN", credentialMode: "PLATFORM_PAID", keywordCount: 3,
          execution: { purpose: "POSITION_TRACKING", depth: 30, source: "YANDEX_SEARCH_API" }
        } : {
          ...estimateResponse(),
          credentialMode: "PLATFORM_PAID",
          status: "READY", executionAllowed: true, blockers: [],
          scope: {
            ...estimateResponse().scope,
            keywordCount: "3",
            pairCount: "3"
          }
        }
      }),
      {
        status: 201,
        headers: { "content-type": "application/json" }
      }
    )) as typeof fetch;

  try {
    const result = await client({
      PLATFORM_ARSENKIN_ENABLED: "true",
      PLATFORM_ARSENKIN_RANK_KEYWORD_PRICE_MINOR: "25",
      PLATFORM_ARSENKIN_DAILY_SPEND_LIMIT_MINOR: "1000",
      PLATFORM_ARSENKIN_MONTHLY_SPEND_LIMIT_MINOR: "10000"
    }).createRankEstimate(context(), internalInput(), "rank-estimate-002");

    assert.equal(result.workload.taskCount, "1");
    assert.equal(result.scope.keywordCount, "3");
    assert.equal(result.platformChargeMicro, "480000", "The current cost book, not an old flat env price, prices the immutable workload");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function client(overrides: NodeJS.ProcessEnv = {}): JobsClient {
  return new JobsClient(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      PLATFORM_API_TO_JOBS_TOKEN: "i".repeat(32),
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32),
      JOBS_INTERNAL_URL: "http://jobs.test:4002",
      ...overrides
    })
  );
}

function context() {
  return {
    tenant: {
      workspaceId,
      workspaceStatus: "ACTIVE" as const,
      projectId,
      projectStatus: "ACTIVE" as const,
      roleCode: "OWNER"
    },
    actorId,
    requestId: "request-rank-estimate-001"
  };
}

function internalInput() {
  return {
    trackingContextId: contextId,
    workspaceId,
    projectId,
    actorId,
    project: {
      id: projectId,
      workspaceId,
      domain: "example.com",
      status: "ACTIVE" as const,
      version: 1
    },
    access: {
      workspaceStatus: "ACTIVE" as const,
      canRunRanking: true,
      entitlementStatus: "NOT_AVAILABLE" as const
    },
    billingCurrency: "RUB",
    quota: { status: "NOT_AVAILABLE" as const }
  };
}

function estimateResponse() {
  return {
    id: "01900000-0000-7000-8000-000000000005",
    workspaceId,
    projectId,
    trackingContextId: contextId,
    status: "BLOCKED",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    credentialMode: "BYOK_API_KEY",
    scope: {
      keywordCount: "1",
      contextCount: "1",
      pairCount: "1",
      scopeHash: {
        availability: "AVAILABLE",
        algorithm: "SHA_256",
        value: "a".repeat(64)
      },
      contextVersion: 1,
      configurationVersion: 1
    },
    workload: {
      taskCount: "1",
      minimumRequestCount: "3",
      pollingRequestCount: { status: "NOT_AVAILABLE" },
      requestStages: ["SET", "CHECK", "GET"],
      keywordLimitPerTask: "250",
      keywordLimitPerCommand: "1000",
      format: "SIMPLE",
      rawSerp: false,
      fallbackMode: "NONE"
    },
    providerLimits: { status: "NOT_AVAILABLE" },
    expectedDuration: { status: "NOT_AVAILABLE" },
    platformChargeMicro: "0",
    billingCurrency: "RUB",
    quota: { status: "NOT_AVAILABLE" },
    credentialFreshness: { status: "NOT_AVAILABLE" },
    retention: {
      normalizedRankHistory: "LONG_TERM",
      rawSerp: "NOT_COLLECTED"
    },
    blockers: [
      { code: "PROVIDER_CONTRACT_NOT_READY" },
      { code: "PROVIDER_EXECUTION_DISABLED" }
    ],
    executionAllowed: false,
    policyVersion: "manual-arsenkin-positions@1.0.0",
    calculatedAt: "2026-07-29T12:00:00.000Z",
    expiresAt: "2026-07-29T12:05:00.000Z"
  };
}
