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

const config = {
  internalApiToken: "trusted-internal-token",
  internalCommandTimeoutMs: 1_000,
  services: {
    seoData: "http://seo-data:4001"
  }
} as AppConfig;

test("accepts a complete normalized batch and forwards trusted context", async () => {
  const originalFetch = globalThis.fetch;
  let observedHeaders: Headers | undefined;
  globalThis.fetch = (async (_input, init) => {
    observedHeaders = new Headers(init?.headers);
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
      "trusted-internal-token"
    );
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
