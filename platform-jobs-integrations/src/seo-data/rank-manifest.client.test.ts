import assert from "node:assert/strict";
import test from "node:test";
import {
  rankManifestChunkHashPreimage,
  type InternalFinalizeRankCheckInput,
  type InternalGetRankManifestChunkInput,
  type InternalRankManifestChunk,
  type InternalRankManifestEntry,
  type InternalSealRankManifestInput
} from "@seo-platform/contracts";
import {
  canonicalJsonSha256,
  utf8Sha256
} from "@seo-platform/contracts/canonical-json";
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
  manifestId: "01900000-0000-7000-8000-000000000007",
  entryId: "01900000-0000-7000-8000-000000000008",
  assignmentId: "01900000-0000-7000-8000-000000000009",
  keywordId: "01900000-0000-7000-8000-00000000000a"
} as const;

const config = {
  rankManifestApiToken: "rank-secret",
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

test("gets an exact bounded manifest chunk through the dedicated boundary", async () => {
  const originalFetch = globalThis.fetch;
  const expected = chunkReceipt();
  let body: unknown;
  let headers: Headers | undefined;
  let method: string | undefined;
  let redirect: string | undefined;
  let url = "";
  globalThis.fetch = (async (request, init) => {
    url = String(request);
    body = init?.body;
    headers = new Headers(init?.headers);
    method = init?.method;
    redirect = init?.redirect;
    return Response.json({
      data: expected,
      meta: { requestId: "seo-rank-chunk-1" }
    });
  }) as typeof fetch;
  try {
    const result = await new RankManifestClient(config).getChunk(
      chunkCommand(),
      ids.actorId
    );
    assert.deepEqual(result, expected);
    assert.equal(
      url,
      `http://seo-data:4001/internal/v1/projects/${ids.projectId}/rank-manifests/${ids.manifestId}/chunks/0?jobId=${ids.jobId}`
    );
    assert.equal(method, "GET");
    assert.equal(body, undefined);
    assert.equal(redirect, "error");
    assert.equal(headers?.get("Content-Type"), null);
    assert.equal(headers?.get("X-Rank-Execution-Token"), "rank-secret");
    assert.equal(headers?.get("X-Workspace-Id"), ids.workspaceId);
    assert.equal(headers?.get("X-Project-Id"), ids.projectId);
    assert.equal(headers?.get("X-Actor-Id"), ids.actorId);
    assert.equal(headers?.get("X-Internal-Token"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects tampered manifest entry and canonical chunk hashes", async () => {
  const originalFetch = globalThis.fetch;
  const exact = chunkReceipt();
  const changedText = {
    ...exact.entries[0],
    keywordText: "tampered keyword"
  };
  const changedEntryWithValidTextHash = {
    ...changedText,
    keywordTextHash: sha256(changedText.keywordText)
  };
  const invalid = [
    { ...exact, entries: [changedText] },
    { ...exact, entries: [changedEntryWithValidTextHash] },
    { ...exact, chunkHash: hash("f") }
  ];
  try {
    for (const candidate of invalid) {
      globalThis.fetch = (async () =>
        Response.json({
          data: candidate,
          meta: { requestId: "seo-rank-chunk-tampered" }
        })) as typeof fetch;
      await assert.rejects(
        () =>
          new RankManifestClient(config).getChunk(
            chunkCommand(),
            ids.actorId
          ),
        unavailable
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects non-canonical, oversized and extensible manifest entries", async () => {
  const originalFetch = globalThis.fetch;
  const exact = chunkReceipt();
  const entry = exact.entries[0] as InternalRankManifestEntry;
  const oversizedText = "x".repeat(501);
  const invalid = [
    { ...entry, language: "EN" },
    { ...entry, keywordText: oversizedText, keywordTextHash: sha256(oversizedText) },
    { ...entry, id: "550e8400-e29b-41d4-a716-446655440000" },
    { ...entry, rawProviderPayload: "must-not-cross" }
  ];
  try {
    for (const candidate of invalid) {
      globalThis.fetch = (async () =>
        Response.json({
          data: { ...exact, entries: [candidate] },
          meta: { requestId: "seo-rank-chunk-entry-invalid" }
        })) as typeof fetch;
      await assert.rejects(
        () =>
          new RankManifestClient(config).getChunk(
            chunkCommand(),
            ids.actorId
          ),
        unavailable
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects cross-scope manifest chunks", async () => {
  const originalFetch = globalThis.fetch;
  const exact = chunkReceipt();
  try {
    for (const candidate of [
      { ...exact, workspaceId: ids.actorId },
      { ...exact, projectId: ids.actorId },
      { ...exact, jobId: ids.actorId },
      { ...exact, manifestId: ids.actorId }
    ]) {
      globalThis.fetch = (async () =>
        Response.json({
          data: candidate,
          meta: { requestId: "seo-rank-chunk-cross-scope" }
        })) as typeof fetch;
      await assert.rejects(
        () =>
          new RankManifestClient(config).getChunk(
            chunkCommand(),
            ids.actorId
          ),
        unavailable
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects oversized and non-json manifest chunk responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const response of [
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": String(1_024 * 1_024 + 1)
        }
      }),
      new Response("not-json", {
        headers: { "content-type": "text/plain" }
      })
    ]) {
      globalThis.fetch = (async () => response) as typeof fetch;
      await assert.rejects(
        () =>
          new RankManifestClient(config).getChunk(
            chunkCommand(),
            ids.actorId
          ),
        unavailable
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects invalid chunk requests before network access", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("must not fetch");
  }) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        new RankManifestClient(config).getChunk(
          { ...chunkCommand(), chunkIndex: 4 },
          ids.actorId
        ),
      (error: unknown) =>
        error instanceof RankManifestClientError &&
        error.code === "INVALID_COMMAND" &&
        !error.retryable
    );
    assert.equal(called, false);
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

function chunkCommand(): InternalGetRankManifestChunkInput {
  return {
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    jobId: ids.jobId,
    manifestId: ids.manifestId,
    chunkIndex: 0
  };
}

function chunkEntry(): InternalRankManifestEntry {
  const keywordText = "rank tracking";
  return {
    id: ids.entryId,
    sequence: 0,
    assignmentId: ids.assignmentId,
    keywordId: ids.keywordId,
    keywordVersion: 2,
    keywordText,
    keywordTextHash: sha256(keywordText),
    language: "en"
  };
}

function chunkReceipt(): InternalRankManifestChunk {
  const chunk: InternalRankManifestChunk = {
    ...chunkCommand(),
    hashSchemaVersion: "rank-manifest-chunk@1",
    chunkHash: hash("0"),
    entries: [chunkEntry()]
  };
  return {
    ...chunk,
    chunkHash: {
      algorithm: "SHA_256",
      value: canonicalJsonSha256(
        "rank-manifest-chunk@1",
        rankManifestChunkHashPreimage(chunk)
      )
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

function sha256(value: string) {
  return {
    algorithm: "SHA_256" as const,
    value: utf8Sha256(value)
  };
}

function unavailable(error: unknown): boolean {
  return (
    error instanceof RankManifestClientError &&
    error.code === "UNAVAILABLE" &&
    error.retryable
  );
}
