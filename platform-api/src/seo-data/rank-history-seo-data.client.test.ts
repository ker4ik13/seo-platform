import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { loadAppConfig } from "../config/app-config.js";
import { SeoDataClient } from "./seo-data.client.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const keywordId = "01900000-0000-7000-8000-000000000004";
const contextId = "01900000-0000-7000-8000-000000000005";
const snapshotId = "01900000-0000-7000-8000-000000000006";
const jobId = "01900000-0000-7000-8000-000000000007";
const cursor = "eyJjdXJzb3IiOiJvcGFxdWUifQ";
const observedFrom = "2026-07-01T00:00:00.000Z";
const observedBefore = "2026-08-01T00:00:00.000Z";

test("forwards a tenant-scoped rank-history query and redacts its response", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl: URL | undefined;
  let capturedHeaders: Headers | undefined;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    capturedUrl = new URL(
      input instanceof Request ? input.url : input.toString()
    );
    capturedHeaders = new Headers(init?.headers);
    return jsonResponse(historyPayload(workspaceId));
  }) as typeof fetch;

  try {
    const result = await client().listRankHistory(
      internalContext(),
      {
        observedFrom,
        observedBefore,
        trackingContextId: contextId,
        keywordId,
        limit: 25,
        cursor
      }
    );

    assert.equal(
      capturedUrl?.pathname,
      `/internal/v1/projects/${projectId}/rank-history`
    );
    assert.deepEqual(
      Object.fromEntries(capturedUrl?.searchParams ?? []),
      {
        observedFrom,
        observedBefore,
        trackingContextId: contextId,
        keywordId,
        limit: "25",
        cursor
      }
    );
    assert.equal(
      capturedHeaders?.get("x-workspace-id"),
      workspaceId
    );
    assert.equal(capturedHeaders?.get("x-project-id"), projectId);
    assert.equal(capturedHeaders?.get("x-actor-id"), actorId);
    assert.equal(result.data[0]?.snapshotId, snapshotId);
    assert.equal(
      JSON.stringify(result.data[0]).includes("private-credential"),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails closed on a cross-workspace SEO Data response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (): Promise<Response> =>
    jsonResponse(
      historyPayload(
        "01900000-0000-7000-8000-000000000099"
      )
    )) as typeof fetch;

  try {
    await assert.rejects(
      client().listRankHistory(internalContext(), {
        observedFrom,
        observedBefore,
        limit: 100
      }),
      (error: unknown) =>
        error instanceof DomainError &&
        error.statusCode === 502 &&
        error.code === "DEPENDENCY_UNAVAILABLE"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function client(): SeoDataClient {
  return new SeoDataClient(
    loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test",
      INTERNAL_API_TOKEN: "i".repeat(32),
      SEO_DATA_INTERNAL_URL: "http://seo-data.test:4001"
    })
  );
}

function internalContext() {
  return {
    tenant: {
      workspaceId,
      workspaceStatus: "READ_ONLY" as const,
      projectId,
      projectStatus: "ARCHIVED" as const,
      roleCode: "OWNER"
    },
    actorId,
    requestId: "request-rank-history-001"
  };
}

function historyPayload(responseWorkspaceId: string) {
  return {
    data: {
      workspaceId: responseWorkspaceId,
      projectId,
      items: [
        {
          snapshotId,
          keywordId,
          trackingContextId: contextId,
          configurationVersion: 2,
          provider: "ARSENKIN",
          connectorVersion: "arsenkin.positions.v1",
          observedAt: "2026-07-29T12:00:00.000Z",
          storedAt: "2026-07-29T12:00:01.000Z",
          jobId,
          dataQualityFlags: [],
          found: true,
          position: 4,
          absolutePosition: 4,
          pixelPosition: 120,
          rankingUrl: "https://example.com/rank",
          normalizedRankingUrl: "https://example.com/rank",
          title: "Ranked page",
          snippet: "Result snippet",
          resultType: "ORGANIC",
          serpFeatures: [],
          credentialId: "private-credential"
        }
      ],
      page: { hasNext: false }
    }
  };
}

function jsonResponse(value: unknown): Response {
  const response = value as Readonly<Record<string, unknown>>;
  return new Response(
    JSON.stringify({
      ...response,
      meta: { requestId: "internal-rank-history-001" }
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" }
    }
  );
}
