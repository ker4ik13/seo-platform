import assert from "node:assert/strict";
import test from "node:test";
import type { InternalCreateRankRunInput } from "@seo-platform/contracts";
import { DomainError } from "../common/domain-error.js";
import { loadAppConfig } from "../config/app-config.js";
import { JobsClient } from "./jobs.client.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const membershipId = "01900000-0000-7000-8000-000000000004";
const estimateId = "01900000-0000-7000-8000-000000000005";
const contextId = "01900000-0000-7000-8000-000000000006";
const jobId = "01900000-0000-7000-8000-000000000007";

test("uses the dedicated boundary for create, scoped get and teammate cancel", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{
    readonly url: URL;
    readonly method: string | undefined;
    readonly headers: Headers;
    readonly body: unknown;
  }> = [];
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    requests.push({
      url: new URL(
        input instanceof Request ? input.url : input.toString()
      ),
      method: init?.method,
      headers: new Headers(init?.headers),
      body:
        typeof init?.body === "string"
          ? JSON.parse(init.body)
          : undefined
    });
    return new Response(JSON.stringify({ data: preparingJob() }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;

  try {
    const jobs = client();
    await jobs.createRankRun(
      context(),
      rankRunCommand(),
      "rank-run-create-0001"
    );
    await jobs.getRankJob(context(), jobId);
    await jobs.cancelRankJob(context(), jobId);

    assert.equal(requests.length, 3);
    assert.equal(
      requests[0]?.url.pathname,
      `/internal/v1/workspaces/${workspaceId}/projects/${projectId}/rank-runs`
    );
    assert.equal(requests[0]?.method, "POST");
    assert.deepEqual(requests[0]?.body, rankRunCommand());
    assert.equal(
      requests[0]?.headers.get("idempotency-key"),
      "rank-run-create-0001"
    );

    assert.equal(
      requests[1]?.url.pathname,
      `/internal/v1/workspaces/${workspaceId}/projects/${projectId}/jobs/${jobId}`
    );
    assert.equal(requests[1]?.method, "GET");
    assert.equal(requests[1]?.body, undefined);
    assert.equal(requests[1]?.headers.get("content-type"), null);

    assert.equal(
      requests[2]?.url.pathname,
      `/internal/v1/workspaces/${workspaceId}/projects/${projectId}/jobs/${jobId}/cancel`
    );
    assert.equal(requests[2]?.method, "POST");
    assert.deepEqual(requests[2]?.body, {
      workspaceId,
      projectId,
      actorId,
      jobId
    });

    for (const request of requests) {
      assert.equal(
        request.headers.get("x-internal-token"),
        "c".repeat(32)
      );
      assert.equal(request.headers.get("x-workspace-id"), workspaceId);
      assert.equal(request.headers.get("x-project-id"), projectId);
      assert.equal(request.headers.get("x-actor-id"), actorId);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps safe rank create conflict reasons without exposing upstream text", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const reason of [
      "ESTIMATE_EXPIRED",
      "ESTIMATE_STALE",
      "EQUIVALENT_RUN_ACTIVE",
      "EXECUTION_GRANT_DENIED"
    ] as const) {
      globalThis.fetch = (async (): Promise<Response> =>
        new Response(
          JSON.stringify({
            error: {
              code: reason,
              message: "private upstream diagnostic",
              details:
                reason === "EQUIVALENT_RUN_ACTIVE"
                  ? { reason, existingJobId: jobId }
                  : { reason }
            }
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" }
          }
        )) as typeof fetch;

      await assert.rejects(
        client().createRankRun(
          context(),
          rankRunCommand(),
          `rank-run-${reason.toLowerCase()}`
        ),
        (error: unknown) =>
          error instanceof DomainError &&
          error.statusCode === 409 &&
          error.code === "RESOURCE_STATE_CONFLICT" &&
          error.details?.reason === reason &&
          (reason !== "EQUIVALENT_RUN_ACTIVE" ||
            error.details?.existingJobId === jobId) &&
          !error.message.includes("private upstream")
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails closed for malformed rank conflict details", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const cases: readonly unknown[] = [
      {
        reason: "EQUIVALENT_RUN_ACTIVE",
        existingJobId: "not-a-job-id"
      },
      {
        reason: "EQUIVALENT_RUN_ACTIVE",
        existingJobId: jobId,
        credentialId: "must-not-cross-boundary"
      },
      {
        reason: "ESTIMATE_STALE"
      },
      undefined
    ];
    for (const [index, details] of cases.entries()) {
      globalThis.fetch = (async (): Promise<Response> =>
        new Response(
          JSON.stringify({
            error: {
              code: "EQUIVALENT_RUN_ACTIVE",
              message: "private upstream diagnostic",
              ...(details === undefined ? {} : { details })
            }
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" }
          }
        )) as typeof fetch;

      await assert.rejects(
        client().createRankRun(
          context(),
          rankRunCommand(),
          `rank-run-malformed-conflict-${index}`
        ),
        (error: unknown) =>
          error instanceof DomainError &&
          error.statusCode === 503 &&
          error.code === "DEPENDENCY_UNAVAILABLE" &&
          error.details === undefined
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses bounded read and command timeouts by HTTP method", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  const observedTimeouts: number[] = [];
  globalThis.fetch = (async (): Promise<Response> =>
    new Response(JSON.stringify({ data: preparingJob() }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;
  AbortSignal.timeout = ((milliseconds: number): AbortSignal => {
    observedTimeouts.push(milliseconds);
    return new AbortController().signal;
  }) as typeof AbortSignal.timeout;

  try {
    const jobs = client();
    await jobs.getRankJob(context(), jobId);
    await jobs.createRankRun(
      context(),
      rankRunCommand(),
      "rank-run-timeout-0001"
    );
    assert.deepEqual(observedTimeouts, [321, 654]);
  } finally {
    AbortSignal.timeout = originalTimeout;
    globalThis.fetch = originalFetch;
  }
});

test("rejects advertised and chunked Jobs responses above two MiB", async () => {
  const originalFetch = globalThis.fetch;
  const maxBytes = 2 * 1024 * 1024;
  let chunkedBodyCancelled = false;
  try {
    globalThis.fetch = (async (): Promise<Response> =>
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(maxBytes + 1)
        }
      })) as typeof fetch;
    await assert.rejects(
      client().getRankJob(context(), jobId),
      invalidDependencyResponse
    );

    let chunkIndex = 0;
    const chunkedBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunkIndex += 1;
        controller.enqueue(
          new Uint8Array(
            chunkIndex === 1
              ? maxBytes
              : 1
          )
        );
      },
      cancel() {
        chunkedBodyCancelled = true;
      }
    });
    globalThis.fetch = (async (): Promise<Response> =>
      new Response(chunkedBody, {
        status: 200,
        headers: { "content-type": "application/json" }
      })) as typeof fetch;
    await assert.rejects(
      client().getRankJob(context(), jobId),
      invalidDependencyResponse
    );
    assert.equal(chunkedBodyCancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects invalid bounded Jobs JSON before mapping HTTP status", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    new Response("not-json", {
      status: 404,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;
  try {
    await assert.rejects(
      client().getRankJob(context(), jobId),
      invalidDependencyResponse
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
      PLATFORM_API_TO_JOBS_TOKEN: "i".repeat(32),
      PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN: "c".repeat(32),
      JOBS_INTERNAL_URL: "http://jobs.test:4002",
      INTERNAL_REQUEST_TIMEOUT_MS: "321",
      INTERNAL_COMMAND_TIMEOUT_MS: "654"
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
      roleCode: "SEO_SPECIALIST",
      membershipId,
      membershipVersion: 3
    },
    actorId,
    requestId: "request-rank-run-001"
  };
}

function rankRunCommand(): InternalCreateRankRunInput {
  return {
    workspaceId,
    projectId,
    actorId,
    estimateId,
    project: {
      id: projectId,
      workspaceId,
      domain: "example.com",
      status: "ACTIVE",
      version: 4
    },
    access: {
      workspaceStatus: "ACTIVE",
      membershipId,
      membershipVersion: 3,
      canRunRanking: true,
      entitlementStatus: "NOT_AVAILABLE",
      quota: { status: "NOT_AVAILABLE" }
    },
    billingCurrency: "RUB"
  };
}

function preparingJob() {
  return {
    id: jobId,
    workspaceId,
    projectId,
    trackingContextId: contextId,
    type: "MANUAL_RANK_CHECK",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    credentialMode: "BYOK_API_KEY",
    status: "PREPARING",
    stage: "PREPARING_SCOPE",
    progress: {
      current: "0",
      total: "2",
      unit: "KEYWORD"
    },
    platformChargeMicro: "0",
    billingCurrency: "RUB",
    createdAt: "2026-07-29T12:00:00.000Z"
  };
}

function invalidDependencyResponse(error: unknown): boolean {
  return (
    error instanceof DomainError &&
    error.statusCode === 502 &&
    error.code === "DEPENDENCY_UNAVAILABLE"
  );
}
