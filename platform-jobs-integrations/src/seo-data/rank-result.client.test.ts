import assert from "node:assert/strict";
import test from "node:test";
import type {
  InternalIngestRankChunkInput,
  InternalRankChunkIngestReceipt
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import {
  RankResultClient,
  RankResultClientError
} from "./rank-result.client.js";

const ids = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  jobId: "01900000-0000-7000-8000-000000000004",
  jobItemId: "01900000-0000-7000-8000-000000000005",
  manifestId: "01900000-0000-7000-8000-000000000006",
  entryId: "01900000-0000-7000-8000-000000000007",
  keywordId: "01900000-0000-7000-8000-000000000008"
} as const;

const config = {
  rankResultApiToken: "rank-result-secret",
  internalCommandTimeoutMs: 1_000,
  services: { seoData: "http://seo-data:4001" }
} as AppConfig;

test("ingests through only the dedicated result boundary", async () => {
  const originalFetch = globalThis.fetch;
  let url = "";
  let headers: Headers | undefined;
  let body: unknown;
  globalThis.fetch = (async (request, init) => {
    url = String(request);
    headers = new Headers(init?.headers);
    body = JSON.parse(String(init?.body)) as unknown;
    return Response.json({
      data: receipt(),
      meta: { requestId: "rank-result-1" }
    });
  }) as typeof fetch;
  try {
    const result = await new RankResultClient(config).ingest(command());
    assert.deepEqual(result, receipt());
    assert.equal(
      url,
      `http://seo-data:4001/internal/v1/projects/${ids.projectId}/rank-manifests/${ids.manifestId}/chunks/0/results`
    );
    assert.deepEqual(body, command());
    assert.equal(
      headers?.get("X-Rank-Result-Token"),
      "rank-result-secret"
    );
    assert.equal(headers?.get("X-Rank-Execution-Token"), null);
    assert.equal(headers?.get("X-Internal-Token"), null);
    assert.equal(headers?.get("X-Workspace-Id"), ids.workspaceId);
    assert.equal(headers?.get("X-Project-Id"), ids.projectId);
    assert.equal(headers?.get("X-Actor-Id"), ids.actorId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a forged or extensible ingest receipt", async () => {
  const originalFetch = globalThis.fetch;
  for (const data of [
    { ...receipt(), persistedCount: "0" },
    { ...receipt(), providerRequestId: "another-task" },
    { ...receipt(), rawProviderResponse: "must-not-cross" }
  ]) {
    globalThis.fetch = (async () =>
      Response.json({
        data,
        meta: { requestId: "rank-result-invalid" }
      })) as typeof fetch;
    await assert.rejects(
      () => new RankResultClient(config).ingest(command()),
      (error: unknown) =>
        error instanceof RankResultClientError &&
        error.code === "UNAVAILABLE" &&
        error.retryable
    );
  }
  globalThis.fetch = originalFetch;
});

function command(): InternalIngestRankChunkInput {
  return {
    schemaVersion: "rank-ingest@1",
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    jobId: ids.jobId,
    jobItemId: ids.jobItemId,
    manifestId: ids.manifestId,
    chunkIndex: 0,
    manifestChunkHash: hash("a"),
    provider: "ARSENKIN",
    operation: "POSITIONS",
    providerRequestId: "task-3944",
    connectorVersion: "arsenkin-positions@2.0.0",
    observedAt: "2026-07-30T12:00:00.000Z",
    results: [
      {
        manifestEntryId: ids.entryId,
        keywordId: ids.keywordId,
        found: false,
        position: null,
        dataQualityFlags: []
      }
    ],
    ingestEnvelopeHash: hash("b")
  };
}

function receipt(): InternalRankChunkIngestReceipt {
  const input = command();
  return {
    schemaVersion: "rank-ingest@1",
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    ingestedBy: ids.actorId,
    jobId: input.jobId,
    jobItemId: input.jobItemId,
    manifestId: input.manifestId,
    chunkIndex: input.chunkIndex,
    manifestChunkHash: input.manifestChunkHash,
    providerRequestId: input.providerRequestId,
    connectorVersion: input.connectorVersion,
    observedAt: input.observedAt,
    ingestEnvelopeHash: input.ingestEnvelopeHash,
    status: "APPLIED",
    persistedCount: "1",
    foundCount: "0",
    notFoundCount: "1",
    currentUpdatedCount: "1",
    currentSkippedCount: "0",
    appliedAt: "2026-07-30T12:00:01.000Z"
  };
}

function hash(character: string) {
  return {
    algorithm: "SHA_256" as const,
    value: character.repeat(64)
  };
}
