import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { internalIngestRankChunkInput } from "./rank-result-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const jobItemId = "01900000-0000-7000-8000-000000000005";
const manifestId = "01900000-0000-7000-8000-000000000006";
const manifestEntryId =
  "01900000-0000-7000-8000-000000000007";
const keywordId = "01900000-0000-7000-8000-000000000008";
const hash = {
  algorithm: "SHA_256",
  value: "a".repeat(64)
} as const;

test("accepts an exact normalized found result", () => {
  const parsed = internalIngestRankChunkInput(
    command({
      manifestEntryId,
      keywordId,
      dataQualityFlags: [
        "ABSOLUTE_POSITION_UNAVAILABLE",
        "PIXEL_POSITION_UNAVAILABLE",
        "TITLE_UNAVAILABLE",
        "SNIPPET_UNAVAILABLE"
      ],
      found: true,
      position: 3,
      rankingUrl: "https://example.com/page",
      normalizedRankingUrl: "https://example.com/page",
      resultType: "ORGANIC",
      serpFeatures: []
    })
  );

  assert.equal(parsed.workspaceId, workspaceId);
  assert.equal(parsed.results[0]?.found, true);
  assert.equal(parsed.results[0]?.position, 3);
});

test("accepts TOP-100 and rejects positions outside the database contract", () => {
  const found = {
    manifestEntryId,
    keywordId,
    dataQualityFlags: [
      "ABSOLUTE_POSITION_UNAVAILABLE",
      "PIXEL_POSITION_UNAVAILABLE",
      "TITLE_UNAVAILABLE",
      "SNIPPET_UNAVAILABLE"
    ],
    found: true,
    position: 100,
    rankingUrl: "https://example.com/page",
    normalizedRankingUrl: "https://example.com/page",
    resultType: "ORGANIC",
    serpFeatures: []
  } as const;

  assert.equal(
    internalIngestRankChunkInput(command(found)).results[0]?.position,
    100
  );
  assert.throws(
    () =>
      internalIngestRankChunkInput(
        command({ ...found, position: 101 })
      ),
    BadRequestException
  );
});

test("accepts not-found only with provider timestamp provenance", () => {
  const parsed = internalIngestRankChunkInput(
    command({
      manifestEntryId,
      keywordId,
      dataQualityFlags: [
        "PROVIDER_OBSERVED_AT_UNAVAILABLE"
      ],
      found: false,
      position: null
    })
  );

  assert.equal(parsed.results[0]?.found, false);
});

test("rejects extra raw provider fields and credential-bearing URLs", () => {
  assert.throws(
    () =>
      internalIngestRankChunkInput({
        ...command({
          manifestEntryId,
          keywordId,
          dataQualityFlags: [],
          found: false,
          position: null
        }),
        rawProviderPayload: { secret: "must-not-cross" }
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalIngestRankChunkInput(
        command({
          manifestEntryId,
          keywordId,
          dataQualityFlags: [
            "ABSOLUTE_POSITION_UNAVAILABLE",
            "PIXEL_POSITION_UNAVAILABLE",
            "TITLE_UNAVAILABLE",
            "SNIPPET_UNAVAILABLE"
          ],
          found: true,
          position: 1,
          rankingUrl: "https://user:secret@example.com/",
          normalizedRankingUrl: "https://example.com/",
          resultType: "ORGANIC",
          serpFeatures: []
        })
      ),
    BadRequestException
  );
});

test("requires availability flags to match absent optional fields", () => {
  assert.throws(
    () =>
      internalIngestRankChunkInput(
        command({
          manifestEntryId,
          keywordId,
          dataQualityFlags: [],
          found: true,
          position: 1,
          rankingUrl: "https://example.com/",
          normalizedRankingUrl: "https://example.com/",
          resultType: "ORGANIC",
          serpFeatures: []
        })
      ),
    BadRequestException
  );
  assert.throws(
    () =>
      internalIngestRankChunkInput(
        command({
          manifestEntryId,
          keywordId,
          dataQualityFlags: ["TITLE_UNAVAILABLE"],
          found: false,
          position: null
        })
      ),
    BadRequestException
  );
});

function command(result: Readonly<Record<string, unknown>>) {
  return {
    schemaVersion: "rank-ingest@1",
    workspaceId,
    projectId,
    actorId,
    jobId,
    jobItemId,
    manifestId,
    chunkIndex: 0,
    manifestChunkHash: hash,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    providerRequestId: "provider-task-1",
    connectorVersion: "arsenkin-positions@1.0.0",
    observedAt: "2026-07-29T12:00:00.000Z",
    results: [result],
    ingestEnvelopeHash: hash
  };
}
