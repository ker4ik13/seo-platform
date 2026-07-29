import assert from "node:assert/strict";
import test from "node:test";
import type {
  InternalFinalizeRankCheckInput,
  InternalSealRankManifestInput
} from "@seo-platform/contracts";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import type { AppConfig } from "../config/app-config.js";
import {
  RankManifestClient,
  RankManifestClientError
} from "./rank-manifest.client.js";

const ids = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  jobId: "01900000-0000-7000-8000-000000000004",
  estimateId: "01900000-0000-7000-8000-000000000005",
  contextId: "01900000-0000-7000-8000-000000000006",
  manifestId: "01900000-0000-7000-8000-000000000007"
} as const;

const config = {
  rankExecutionApiToken: "rank-secret",
  internalCommandTimeoutMs: 1_000,
  services: { seoData: "http://seo-data:4001" }
} as AppConfig;

test("uses only the dedicated token and accepts an exact seal receipt", async () => {
  const originalFetch = globalThis.fetch;
  let headers: Headers | undefined;
  let redirect: string | undefined;
  let url = "";
  globalThis.fetch = (async (request, init) => {
    url = String(request);
    headers = new Headers(init?.headers);
    redirect = init?.redirect;
    return Response.json({
      data: receipt(),
      meta: { requestId: "seo-rank-1" }
    });
  }) as typeof fetch;
  try {
    const result = await new RankManifestClient(config).seal(command());
    assert.equal(result.id, ids.manifestId);
    assert.equal(result.estimateExpiresAt, command().estimate.expiresAt);
    assert.equal(
      url,
      `http://seo-data:4001/internal/v1/projects/${ids.projectId}/rank-manifests`
    );
    assert.equal(
      headers?.get("X-Rank-Execution-Token"),
      "rank-secret"
    );
    assert.equal(headers?.get("X-Internal-Token"), null);
    assert.equal(redirect, "error");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves finite manifest conflict codes for the recovery state machine", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json(
      {
        error: {
          code: "ESTIMATE_EXPIRED",
          message: "expired"
        }
      },
      { status: 409 }
    )) as typeof fetch;
  try {
    await assert.rejects(
      () => new RankManifestClient(config).seal(command()),
      (error: unknown) =>
        error instanceof RankManifestClientError &&
        error.code === "ESTIMATE_EXPIRED" &&
        !error.retryable
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("finalizes through the same dedicated boundary and verifies the receipt hash", async () => {
  const originalFetch = globalThis.fetch;
  let url = "";
  let headers: Headers | undefined;
  globalThis.fetch = (async (request, init) => {
    url = String(request);
    headers = new Headers(init?.headers);
    return Response.json({
      data: finalizationReceipt(),
      meta: { requestId: "seo-finalize-1" }
    });
  }) as typeof fetch;
  try {
    const result = await new RankManifestClient(config).finalize(
      finalizationCommand(),
      {
        trackingContextId: ids.contextId,
        configurationVersion: 2,
        pairCount: 2
      }
    );
    assert.equal(result.status, "CANCELLED");
    assert.equal(
      url,
      `http://seo-data:4001/internal/v1/projects/${ids.projectId}/rank-manifests/${ids.manifestId}/finalize`
    );
    assert.equal(
      headers?.get("X-Rank-Execution-Token"),
      "rank-secret"
    );
    assert.equal(headers?.get("X-Actor-Id"), ids.actorId);
    assert.equal(headers?.get("X-Internal-Token"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects forged finalization counts and request hashes", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const candidate of [
      { ...finalizationReceipt(), persistedCount: "1" },
      { ...finalizationReceipt(), requestHash: hash("f") }
    ]) {
      globalThis.fetch = (async () =>
        Response.json({
          data: candidate,
          meta: { requestId: "seo-finalize-invalid" }
        })) as typeof fetch;
      await assert.rejects(
        () =>
          new RankManifestClient(config).finalize(
            finalizationCommand(),
            {
              trackingContextId: ids.contextId,
              configurationVersion: 2,
              pairCount: 2
            }
          ),
        (error: unknown) =>
          error instanceof RankManifestClientError &&
          error.code === "UNAVAILABLE"
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects extensible, mismatched and oversized responses", async () => {
  const originalFetch = globalThis.fetch;
  const invalid = [
    { ...receipt(), keywordText: "must-not-cross" },
    { ...receipt(), workspaceId: ids.actorId },
    { ...receipt(), estimateExpiresAt: "2026-07-29T12:06:00.000Z" }
  ];
  try {
    for (const candidate of invalid) {
      globalThis.fetch = (async () =>
        Response.json({
          data: candidate,
          meta: { requestId: "seo-rank-invalid" }
        })) as typeof fetch;
      await assert.rejects(
        () => new RankManifestClient(config).seal(command()),
        (error: unknown) =>
          error instanceof RankManifestClientError &&
          error.code === "UNAVAILABLE"
      );
    }
    globalThis.fetch = (async () =>
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": String(65 * 1_024)
        }
      })) as typeof fetch;
    await assert.rejects(
      () => new RankManifestClient(config).seal(command()),
      (error: unknown) =>
        error instanceof RankManifestClientError &&
        error.code === "UNAVAILABLE"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function command(): InternalSealRankManifestInput {
  return {
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    jobId: ids.jobId,
    estimateId: ids.estimateId,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    project: {
      id: ids.projectId,
      workspaceId: ids.workspaceId,
      domain: "example.com",
      status: "ACTIVE",
      version: 4
    },
    estimate: {
      trackingContextId: ids.contextId,
      contextVersion: 3,
      configurationVersion: 2,
      configurationHash: hash("a"),
      semanticScopeHash: hash("b"),
      scopeHash: hash("c"),
      pairCount: "2",
      expiresAt: "2026-07-29T12:05:00.000Z"
    },
    execution: {
      searchEngine: "GOOGLE",
      countryCode: "US",
      language: "en",
      device: "DESKTOP",
      depth: 30,
      domainMatchRule: { mode: "EXACT_HOST" },
      safeSearch: false,
      format: "SIMPLE",
      rawSerp: false,
      fallbackMode: "NONE",
      providerMappingVersion: "arsenkin-positions@1"
    },
    retention: {
      normalizedRankHistory: "LONG_TERM",
      rawSerp: "NOT_COLLECTED"
    }
  };
}

function receipt() {
  const input = command();
  return {
    id: ids.manifestId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    jobId: input.jobId,
    estimateId: input.estimateId,
    estimateExpiresAt: input.estimate.expiresAt,
    sealedBy: input.actorId,
    trackingContextId: input.estimate.trackingContextId,
    provider: input.provider,
    operation: input.operation,
    project: input.project,
    contextVersion: input.estimate.contextVersion,
    configurationVersion: input.estimate.configurationVersion,
    configurationHash: input.estimate.configurationHash,
    semanticScopeHash: input.estimate.semanticScopeHash,
    scopeHash: input.estimate.scopeHash,
    hashSchemaVersion: "rank-manifest@1",
    manifestHash: hash("d"),
    deduplicationHash: hash("e"),
    pairCount: "2",
    chunkCount: "1",
    chunkSize: "250",
    execution: input.execution,
    retention: input.retention,
    status: "SEALED",
    sealedAt: "2026-07-29T12:00:00.000Z"
  };
}

function finalizationCommand(): InternalFinalizeRankCheckInput {
  return {
    schemaVersion: "rank-finalize@1",
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    jobId: ids.jobId,
    manifestId: ids.manifestId,
    status: "CANCELLED"
  };
}

function finalizationReceipt() {
  const input = finalizationCommand();
  return {
    schemaVersion: "rank-finalize@1",
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    jobId: input.jobId,
    manifestId: input.manifestId,
    requestHash: {
      algorithm: "SHA_256" as const,
      value: canonicalJsonSha256("rank-finalize@1", {
        schemaVersion: input.schemaVersion,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        jobId: input.jobId,
        manifestId: input.manifestId,
        status: input.status
      })
    },
    trackingContextId: ids.contextId,
    configurationVersion: 2,
    status: input.status,
    pairCount: "2",
    persistedCount: "0",
    foundCount: "0",
    notFoundCount: "0",
    missingCount: "2",
    finalizedAt: "2026-07-29T12:01:00.000Z"
  };
}

function hash(value: string) {
  return {
    algorithm: "SHA_256" as const,
    value: value.repeat(64)
  };
}
