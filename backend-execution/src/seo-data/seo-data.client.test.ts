import assert from "node:assert/strict";
import test from "node:test";
import {
  rankProviderKeywordLimit,
  rankProviderOverflowCount
} from "@seo-platform/contracts";
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

test("uses the Jobs-only semantic export read boundary", async () => {
  const originalFetch = globalThis.fetch;
  const observed: Array<{ readonly url: string; readonly headers: Headers }> = [];
  globalThis.fetch = (async (input, init) => {
    observed.push({
      url: String(input),
      headers: new Headers(init?.headers)
    });
    const url = String(input);
    if (url.endsWith("/semantic-exports/keyword-groups")) {
      return Response.json({ data: [], meta: { requestId: "groups" } });
    }
    if (url.endsWith("/semantic-exports/custom-columns")) {
      return Response.json({ data: [], meta: { requestId: "columns" } });
    }
    if (url.includes("/semantic-exports/competitors?")) {
      return Response.json({
        data: [{
          keywordId: "01900000-0000-7000-8000-000000000011",
          competitors: [{
            source: "SERP",
            url: "https://competitor.example/page",
            normalizedUrl: "https://competitor.example/page",
            title: "Competitor"
          }]
        }],
        page: { hasNext: false, totalApprox: 1 },
        meta: { requestId: "competitors" }
      });
    }
    return Response.json({
      data: [],
      page: { hasNext: false, totalApprox: 0 },
      meta: { requestId: "keywords" }
    });
  }) as typeof fetch;
  try {
    const client = new SeoDataClient(config);
    await client.listExportKeywords(context, {
      limit: 500,
      search: "seo",
      sort: "CREATED_ASC"
    });
    await client.listExportKeywordGroups(context);
    await client.listExportCustomColumns(context);
    const competitorPage = await client.listExportCompetitors(
      context,
      { limit: 100, sort: "CREATED_DESC" },
      { sources: ["SERP", "AI"] }
    );
    assert.equal(competitorPage.data[0]?.competitors[0]?.source, "SERP");
    await client.listExportPositionHistory(
      context,
      { limit: 25, sort: "CREATED_DESC" },
      {
        observedFrom: "2026-08-01T00:00:00.000Z",
        observedBefore: "2026-08-20T00:00:00.000Z",
        searchEngines: ["YANDEX", "GOOGLE"]
      }
    );

    assert.deepEqual(
      observed.map(({ url }) => url),
      [
        `http://seo-data:4001/internal/v1/projects/${context.projectId}/semantic-exports/keywords?limit=500&search=seo&sort=CREATED_ASC`,
        `http://seo-data:4001/internal/v1/projects/${context.projectId}/semantic-exports/keyword-groups`,
        `http://seo-data:4001/internal/v1/projects/${context.projectId}/semantic-exports/custom-columns`,
        `http://seo-data:4001/internal/v1/projects/${context.projectId}/semantic-exports/competitors?limit=100&sort=CREATED_DESC&sources=SERP%2CAI`,
        `http://seo-data:4001/internal/v1/projects/${context.projectId}/semantic-exports/position-history?limit=25&sort=CREATED_DESC&observedFrom=2026-08-01T00%3A00%3A00.000Z&observedBefore=2026-08-20T00%3A00%3A00.000Z&searchEngines=YANDEX%2CGOOGLE`
      ]
    );
    for (const { headers: requestHeaders } of observed) {
      assert.equal(requestHeaders.get("X-Internal-Token"), seoDataApiToken);
      assert.equal(requestHeaders.get("X-Workspace-Id"), context.workspaceId);
      assert.equal(requestHeaders.get("X-Project-Id"), context.projectId);
      assert.equal(requestHeaders.get("X-Actor-Id"), context.actorId);
    }
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

test("accepts rank scopes through the current provider limit and its overflow sentinel", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [keywordCount, semanticScopeHash] of [
      ["1640", rankScope().semanticScopeHash],
      [String(rankProviderKeywordLimit), rankScope().semanticScopeHash],
      [String(rankProviderOverflowCount), { availability: "UNAVAILABLE" }]
    ] as const) {
      globalThis.fetch = (async () =>
        Response.json({
          data: {
            ...rankScope(),
            keywordCount,
            pairCount: keywordCount,
            semanticScopeHash
          },
          meta: { requestId: "seo-request-current-rank-limit" }
        })) as typeof fetch;

      const result = await new SeoDataClient(config).rankEstimateScope({
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        actorId: context.actorId,
        trackingContextId: context.importId
      });

      assert.equal(result.keywordCount, keywordCount);
      assert.deepEqual(result.semanticScopeHash, semanticScopeHash);
    }
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
        keywordCount: String(rankProviderOverflowCount),
        pairCount: String(rankProviderOverflowCount)
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
