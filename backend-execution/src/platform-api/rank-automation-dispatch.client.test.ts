import assert from "node:assert/strict";
import test from "node:test";
import type { InternalDispatchRankAutomationRunInput } from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import {
  RankAutomationDispatchClient,
  RankAutomationDispatchError
} from "./rank-automation-dispatch.client.js";

const input = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  automationId: "01900000-0000-7000-8000-000000000004",
  automationVersion: 2,
  runId: "01900000-0000-7000-8000-000000000005",
  idempotencyKey:
    "rank-automation-dispatch-01900000-0000-7000-8000-000000000005",
  scheduledFor: "2026-09-05T08:30:00.000Z",
  trackingContextId: "01900000-0000-7000-8000-000000000006",
  maxPlatformChargeMicro: "12500000"
} as const satisfies InternalDispatchRankAutomationRunInput;

const config = {
  automationDispatchApiToken: "automation-secret",
  internalCommandTimeoutMs: 60_000,
  platformApiCommandTimeoutMs: 2_500,
  services: { platformApi: "http://backend-core:4000" }
} as AppConfig;

test("sends the exact tenant-bound command and accepts a minimal receipt", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = (async (url: URL, init?: RequestInit) => {
    requestedUrl = String(url);
    requestedInit = init;
    return response();
  }) as typeof fetch;
  try {
    const result = await new RankAutomationDispatchClient(config).dispatch(input);
    assert.deepEqual(result, {
      estimateId: "01900000-0000-7000-8000-000000000007",
      jobId: "01900000-0000-7000-8000-000000000008"
    });
    assert.equal(
      requestedUrl,
      `http://backend-core:4000/internal/v1/workspaces/${input.workspaceId}/projects/${input.projectId}/rank-automation-runs/dispatch`
    );
    const headers = new Headers(requestedInit?.headers);
    assert.equal(headers.get("x-automation-token"), "automation-secret");
    assert.equal(headers.get("x-workspace-id"), input.workspaceId);
    assert.equal(headers.get("x-project-id"), input.projectId);
    assert.equal(headers.get("x-actor-id"), input.actorId);
    assert.equal(headers.get("idempotency-key"), input.idempotencyKey);
    assert.deepEqual(JSON.parse(String(requestedInit?.body)), input);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects over-specified or request-mismatched Platform receipts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    response({ extra: "unexpected" })) as typeof fetch;
  try {
    await assert.rejects(
      new RankAutomationDispatchClient(config).dispatch(input),
      (error: unknown) =>
        error instanceof RankAutomationDispatchError &&
        error.code === "INVALID_RESPONSE" &&
        !error.retryable
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function response(extra: Readonly<Record<string, unknown>> = {}): Response {
  return Response.json(
    {
      data: {
        estimateId: "01900000-0000-7000-8000-000000000007",
        jobId: "01900000-0000-7000-8000-000000000008",
        ...extra
      },
      meta: { requestId: `rank-automation-${input.runId}` }
    },
    {
      status: 201,
      headers: { "cache-control": "private, no-store" }
    }
  );
}
