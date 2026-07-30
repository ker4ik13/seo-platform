import assert from "node:assert/strict";
import test from "node:test";
import {
  rankExecutionGrantRequestHashDomain,
  rankExecutionGrantRequestHashPreimage,
  rankExecutionGrantScopeHashDomain,
  rankExecutionGrantScopeHashPreimage,
  type InternalIssueRankExecutionGrantInputV1,
  type InternalRankExecutionGrantDecisionV1,
  type RankManifestHash
} from "@seo-platform/contracts";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import type { AppConfig } from "../config/app-config.js";
import {
  RankExecutionGrantClient,
  RankExecutionGrantClientError
} from "./rank-execution-grant.client.js";

const ids = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  membershipId: "01900000-0000-7000-8000-000000000004",
  jobId: "01900000-0000-7000-8000-000000000005",
  jobItemId: "01900000-0000-7000-8000-000000000006",
  manifestId: "01900000-0000-7000-8000-000000000007",
  grantId: "01900000-0000-7000-8000-000000000008"
} as const;

const context = {
  requestId: "rank-grant-request-1",
  idempotencyKey: "rank-grant-item-0001"
} as const;

const config = {
  rankGrantApiToken: "grant-secret",
  platformApiCommandTimeoutMs: 2_500,
  services: {
    platformApi: "http://platform-api:4000",
    seoData: "http://seo-data:4001"
  }
} as AppConfig;

test("posts an exact grant command through only the dedicated boundary", async () => {
  const originalFetch = globalThis.fetch;
  let url = "";
  let method: string | undefined;
  let redirect: string | undefined;
  let headers: Headers | undefined;
  let body: unknown;
  globalThis.fetch = (async (request, init) => {
    url = String(request);
    method = init?.method;
    redirect = init?.redirect;
    headers = new Headers(init?.headers);
    body = JSON.parse(String(init?.body));
    return response(deniedDecision());
  }) as typeof fetch;

  try {
    const input = grantInput();
    const decision = await new RankExecutionGrantClient(config).issue(
      input,
      context
    );
    assert.equal(decision.status, "DENIED");
    assert.equal(
      url,
      `http://platform-api:4000/internal/v1/workspaces/${ids.workspaceId}/projects/${ids.projectId}/rank-execution-grants`
    );
    assert.equal(method, "POST");
    assert.equal(redirect, "error");
    assert.equal(headers?.get("X-Rank-Grant-Token"), "grant-secret");
    assert.equal(headers?.get("X-Request-Id"), context.requestId);
    assert.equal(headers?.get("X-Workspace-Id"), ids.workspaceId);
    assert.equal(headers?.get("X-Project-Id"), ids.projectId);
    assert.equal(headers?.get("X-Actor-Id"), ids.actorId);
    assert.equal(
      headers?.get("Idempotency-Key"),
      context.idempotencyKey
    );
    assert.equal(headers?.get("X-Internal-Token"), null);
    assert.equal(headers?.get("X-Rank-Execution-Token"), null);
    assert.deepEqual(body, input);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts a granted decision only with both independent canonical hashes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    response(grantedDecision(), 201)) as typeof fetch;
  try {
    const decision = await new RankExecutionGrantClient(config).issue(
      grantInput(),
      context
    );
    assert.equal(decision.status, "GRANTED");
    if (decision.status === "GRANTED") {
      assert.deepEqual(decision.grant.requestHash, requestHash());
      assert.deepEqual(decision.grant.scopeHash, scopeHash());
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects forged request and scope hashes after contract parsing", async () => {
  const originalFetch = globalThis.fetch;
  const forgedRequest = {
    ...deniedDecision(),
    requestHash: hash("f")
  } satisfies InternalRankExecutionGrantDecisionV1;
  const granted = grantedDecision();
  assert.equal(granted.status, "GRANTED");
  const forgedScope = {
    ...granted,
    grant: {
      ...granted.grant,
      scopeHash: hash("e")
    }
  } satisfies InternalRankExecutionGrantDecisionV1;

  try {
    for (const candidate of [forgedRequest, forgedScope]) {
      globalThis.fetch = (async () => response(candidate)) as typeof fetch;
      await assert.rejects(
        () =>
          new RankExecutionGrantClient(config).issue(
            grantInput(),
            context
          ),
        invalidResponse
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requires an exact no-store envelope and matching request id", async () => {
  const originalFetch = globalThis.fetch;
  const decision = deniedDecision();
  const invalidBodies = [
    {
      data: decision,
      meta: { requestId: context.requestId },
      diagnostics: {}
    },
    {
      data: decision,
      meta: { requestId: context.requestId, version: 1 }
    },
    {
      data: decision,
      meta: { requestId: "other-request" }
    }
  ];
  try {
    for (const candidate of invalidBodies) {
      globalThis.fetch = (async () =>
        jsonResponse(candidate)) as typeof fetch;
      await assert.rejects(
        () =>
          new RankExecutionGrantClient(config).issue(
            grantInput(),
            context
          ),
        invalidResponse
      );
    }

    globalThis.fetch = (async () =>
      Response.json(
        { data: decision, meta: { requestId: context.requestId } },
        { status: 200 }
      )) as typeof fetch;
    await assert.rejects(
      () =>
        new RankExecutionGrantClient(config).issue(grantInput(), context),
      invalidResponse
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts only 200/201 and preserves a finite idempotency conflict", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      jsonResponse({ error: { code: "IDEMPOTENCY_CONFLICT" } }, 409)) as typeof fetch;
    await assert.rejects(
      () =>
        new RankExecutionGrantClient(config).issue(grantInput(), context),
      (error: unknown) =>
        error instanceof RankExecutionGrantClientError &&
        error.code === "IDEMPOTENCY_CONFLICT" &&
        !error.retryable
    );

    globalThis.fetch = (async () =>
      response(deniedDecision(), 202)) as typeof fetch;
    await assert.rejects(
      () =>
        new RankExecutionGrantClient(config).issue(grantInput(), context),
      (error: unknown) =>
        error instanceof RankExecutionGrantClientError &&
        error.code === "UNAVAILABLE" &&
        !error.retryable
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps proxy retry statuses retryable without trusting their body", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const candidate of [
      new Response("<html>bad gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" }
      }),
      new Response(null, { status: 429 })
    ]) {
      globalThis.fetch = (async () => candidate) as typeof fetch;
      await assert.rejects(
        () =>
          new RankExecutionGrantClient(config).issue(
            grantInput(),
            context
          ),
        (error: unknown) =>
          error instanceof RankExecutionGrantClientError &&
          error.code === "UNAVAILABLE" &&
          error.retryable
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bounds declared and streamed response bodies at 64 KiB", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response("{}", {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
          "content-length": String(65 * 1_024)
        }
      })) as typeof fetch;
    await assert.rejects(
      () =>
        new RankExecutionGrantClient(config).issue(grantInput(), context),
      invalidResponse
    );

    globalThis.fetch = (async () =>
      new Response(`{"padding":"${"x".repeat(65 * 1_024)}"}`, {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json"
        }
      })) as typeof fetch;
    await assert.rejects(
      () =>
        new RankExecutionGrantClient(config).issue(grantInput(), context),
      invalidResponse
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects malformed local headers before fetch and transport ambiguity as retryable", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("connection reset");
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        new RankExecutionGrantClient(config).issue(grantInput(), {
          requestId: "bad request id",
          idempotencyKey: context.idempotencyKey
        }),
      (error: unknown) =>
        error instanceof RankExecutionGrantClientError &&
        error.code === "INVALID_REQUEST" &&
        !error.retryable
    );
    assert.equal(calls, 0);

    await assert.rejects(
      () =>
        new RankExecutionGrantClient(config).issue(grantInput(), context),
      (error: unknown) =>
        error instanceof RankExecutionGrantClientError &&
        error.code === "UNAVAILABLE" &&
        error.retryable
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function grantInput(): InternalIssueRankExecutionGrantInputV1 {
  return {
    schemaVersion: "rank-execution-grant-request@1",
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    membership: { id: ids.membershipId, version: 3 },
    project: { version: 4, domainHash: hash("a") },
    jobId: ids.jobId,
    jobItemId: ids.jobItemId,
    jobVersion: 2,
    executionAttempt: 1,
    purpose: "PROVIDER_SUBMIT",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    capability: "SERP_RANK_TRACKING",
    credentialMode: "BYOK_API_KEY",
    manifest: {
      id: ids.manifestId,
      hash: hash("b"),
      chunkIndex: 0
    },
    executionEvidenceHash: hash("c"),
    policyVersion: "arsenkin-positions@1",
    usageIntent: { meter: "RANK_PROVIDER_TASK", quantity: "1" }
  };
}

function deniedDecision(): InternalRankExecutionGrantDecisionV1 {
  return {
    schemaVersion: "rank-execution-grant-decision@1",
    status: "DENIED",
    requestHash: requestHash(),
    decidedAt: "2026-07-29T12:00:00.000Z",
    reason: "ENTITLEMENT_NOT_AVAILABLE"
  };
}

function grantedDecision(): InternalRankExecutionGrantDecisionV1 {
  const expectedRequestHash = requestHash();
  return {
    schemaVersion: "rank-execution-grant-decision@1",
    status: "GRANTED",
    requestHash: expectedRequestHash,
    decidedAt: "2026-07-29T12:00:00.000Z",
    grant: {
      schemaVersion: "rank-execution-grant@1",
      id: ids.grantId,
      requestHash: expectedRequestHash,
      scopeHash: scopeHash(),
      issuer: "PLATFORM_API",
      issuedAt: "2026-07-29T12:00:00.000Z",
      expiresAt: "2026-07-29T12:00:30.000Z"
    }
  };
}

function requestHash(): RankManifestHash {
  const input = grantInput();
  return {
    algorithm: "SHA_256",
    value: canonicalJsonSha256(
      rankExecutionGrantRequestHashDomain,
      rankExecutionGrantRequestHashPreimage(input)
    )
  };
}

function scopeHash(): RankManifestHash {
  const input = grantInput();
  return {
    algorithm: "SHA_256",
    value: canonicalJsonSha256(
      rankExecutionGrantScopeHashDomain,
      rankExecutionGrantScopeHashPreimage(input)
    )
  };
}

function response(
  decision: InternalRankExecutionGrantDecisionV1,
  status = 200
): Response {
  return jsonResponse(
    { data: decision, meta: { requestId: context.requestId } },
    status
  );
}

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "private, no-store" }
  });
}

function invalidResponse(error: unknown): boolean {
  return (
    error instanceof RankExecutionGrantClientError &&
    error.code === "INVALID_RESPONSE" &&
    !error.retryable
  );
}

function hash(value: string): RankManifestHash {
  return { algorithm: "SHA_256", value: value.repeat(64) };
}
