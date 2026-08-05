import assert from "node:assert/strict";
import test from "node:test";
import type { AppConfig } from "../config/app-config.js";
import {
  SeoDataClient,
  SeoDataClientError
} from "./seo-data.client.js";

const context = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  importId: "01900000-0000-7000-8000-000000000004"
} as const;

const seoDataApiToken = "s".repeat(32);
const config = {
  seoDataApiToken,
  internalCommandTimeoutMs: 1_000,
  services: {
    seoData: "http://seo-data:4001"
  }
} as AppConfig;

test("accepts a complete normalized batch and forwards trusted context", async () => {
  const originalFetch = globalThis.fetch;
  let observedHeaders: Headers | undefined;
  let observedRedirect: RequestInit["redirect"];
  globalThis.fetch = (async (_input, init) => {
    observedHeaders = new Headers(init?.headers);
    observedRedirect = init?.redirect;
    return Response.json({
      data: {
        rows: [
          {
            rowNumber: "1",
            textOriginal: "SEO",
            textNormalized: "seo",
            normalizedHash: "a".repeat(64),
            language: "en",
            existsInProject: false
          }
        ]
      }
    });
  }) as typeof fetch;
  try {
    const result = await new SeoDataClient(config).normalizeKeywords({
      ...context,
      rows: [{ rowNumber: "1", text: "SEO", language: "en" }]
    });
    assert.equal(result.rows[0]?.textNormalized, "seo");
    assert.equal(
      observedHeaders?.get("X-Workspace-Id"),
      context.workspaceId
    );
    assert.equal(
      observedHeaders?.get("X-Internal-Token"),
      seoDataApiToken
    );
    assert.equal(observedRedirect, "error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("treats an incomplete normalization response as retryable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({ data: { rows: [] } })) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        new SeoDataClient(config).normalizeKeywords({
          ...context,
          rows: [{ rowNumber: "1", text: "SEO", language: "en" }]
        }),
      (error: unknown) =>
        error instanceof SeoDataClientError &&
        error.code === "UNAVAILABLE" &&
        error.retryable
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts only a bounded redacted rank scope for the trusted project", async () => {
  const originalFetch = globalThis.fetch;
  let observedUrl = "";
  let observedBody: unknown;
  globalThis.fetch = (async (request, init) => {
    observedUrl = String(request);
    observedBody = JSON.parse(String(init?.body));
    return Response.json({
      data: rankScope(),
      meta: { requestId: "seo-request-1" }
    });
  }) as typeof fetch;
  try {
    const result = await new SeoDataClient(config).rankEstimateScope({
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      actorId: context.actorId,
      trackingContextId: context.importId
    });
    assert.equal(result.keywordCount, "251");
    assert.equal(result.semanticScopeHash.availability, "AVAILABLE");
    assert.equal(
      observedUrl,
      `http://seo-data:4001/internal/v1/projects/${context.projectId}/rank-estimate-scopes`
    );
    assert.deepEqual(observedBody, {
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      actorId: context.actorId,
      trackingContextId: context.importId
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts an unavailable hash for a bounded provider-incompatible scope", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      data: {
        ...rankScope(),
        keywordCount: "1",
        pairCount: "1",
        semanticScopeHash: { availability: "UNAVAILABLE" }
      },
      meta: { requestId: "seo-request-unavailable-bounded" }
    })) as typeof fetch;
  try {
    const result = await new SeoDataClient(config).rankEstimateScope({
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      actorId: context.actorId,
      trackingContextId: context.importId
    });

    assert.equal(result.keywordCount, "1");
    assert.deepEqual(result.semanticScopeHash, {
      availability: "UNAVAILABLE"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects secret-bearing, unhashable-empty or scope-inconsistent rank scope responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const data of [
      { ...rankScope(), keywordText: "private keyword sentinel" },
      { ...rankScope(), projectId: context.actorId },
      {
        ...rankScope(),
        keywordCount: "0",
        pairCount: "0",
        semanticScopeHash: { availability: "UNAVAILABLE" }
      },
      {
        ...rankScope(),
        keywordCount: "1001",
        pairCount: "1001"
      }
    ]) {
      globalThis.fetch = (async () =>
        Response.json({
          data,
          meta: { requestId: "seo-request-2" }
        })) as typeof fetch;
      await assert.rejects(
        () =>
          new SeoDataClient(config).rankEstimateScope({
            workspaceId: context.workspaceId,
            projectId: context.projectId,
            actorId: context.actorId,
            trackingContextId: context.importId
          }),
        (error: unknown) =>
          error instanceof SeoDataClientError &&
          error.code === "UNAVAILABLE"
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects an oversized or extensible rank scope envelope", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const response of [
      Response.json({
        data: rankScope(),
        meta: { requestId: "seo-request-3", secret: "unexpected" }
      }),
      new Response("x".repeat(64 * 1_024 + 1), {
        headers: { "Content-Type": "application/json" }
      })
    ]) {
      globalThis.fetch = (async () => response) as typeof fetch;
      await assert.rejects(
        () =>
          new SeoDataClient(config).rankEstimateScope({
            workspaceId: context.workspaceId,
            projectId: context.projectId,
            actorId: context.actorId,
            trackingContextId: context.importId
          }),
        (error: unknown) =>
          error instanceof SeoDataClientError &&
          error.code === "UNAVAILABLE"
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function rankScope() {
  return {
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    trackingContextId: context.importId,
    contextStatus: "ACTIVE",
    contextVersion: 3,
    configurationVersion: 3,
    configurationHash: "a".repeat(64),
    configuration: {
      searchEngine: "GOOGLE",
      countryCode: "RU",
      regionCode: "213",
      regionLabel: "Moscow",
      language: "ru",
      device: "DESKTOP",
      depth: 30,
      domainMatchRule: { mode: "EXACT_HOST" },
      safeSearch: false
    },
    keywordCount: "251",
    contextCount: "1",
    pairCount: "251",
    semanticScopeHash: {
      availability: "AVAILABLE",
      algorithm: "SHA_256",
      value: "b".repeat(64)
    },
    calculatedAt: "2026-07-29T10:00:00.000Z"
  };
}
