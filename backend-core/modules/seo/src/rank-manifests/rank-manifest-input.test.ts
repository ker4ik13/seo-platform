import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalGetRankManifestChunkInput,
  internalRankManifestChunkQuery,
  internalSealRankManifestInput
} from "./rank-manifest-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const estimateId = "01900000-0000-7000-8000-000000000005";
const trackingContextId =
  "01900000-0000-7000-8000-000000000006";
const manifestId = "01900000-0000-7000-8000-000000000007";

test("validates and canonicalizes a manifest seal command", () => {
  const input = internalSealRankManifestInput({
    ...command(),
    workspaceId: workspaceId.toUpperCase(),
    execution: {
      ...command().execution,
      countryCode: "us",
      language: "EN-us",
      regionCode: "  us-ca  "
    }
  });

  assert.equal(input.workspaceId, workspaceId);
  assert.equal(input.execution.countryCode, "US");
  assert.equal(input.execution.language, "en-US");
  assert.equal(input.execution.regionCode, "us-ca");
  assert.deepEqual(Object.keys(input).sort(), [
    "actorId",
    "estimate",
    "estimateId",
    "execution",
    "jobId",
    "operation",
    "project",
    "projectId",
    "provider",
    "retention",
    "workspaceId"
  ]);
});

test("accepts a Yandex Top-50 execution without weakening the sealed shape", () => {
  const input = internalSealRankManifestInput({
    ...command(),
    execution: {
      ...command().execution,
      searchEngine: "YANDEX",
      regionCode: "213",
      depth: 50
    }
  });

  assert.equal(input.execution.searchEngine, "YANDEX");
  assert.equal(input.execution.regionCode, "213");
  assert.equal(input.execution.depth, 50);
});

test("rejects unknown fields, malformed hashes and forged project scope", () => {
  assert.throws(
    () =>
      internalSealRankManifestInput({
        ...command(),
        credentialId: actorId
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalSealRankManifestInput({
        ...command(),
        estimate: {
          ...command().estimate,
          semanticScopeHash: {
            algorithm: "SHA_256",
            value: "A".repeat(64)
          }
        }
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalSealRankManifestInput({
        ...command(),
        project: {
          ...command().project,
          id: "01900000-0000-7000-8000-000000000099"
        }
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalSealRankManifestInput({
        ...command(),
        estimate: {
          ...command().estimate,
          pairCount: "01"
        }
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalSealRankManifestInput({
        ...command(),
        estimate: {
          ...command().estimate,
          expiresAt: "2026-07-29T12:05:00Z"
        }
      }),
    BadRequestException
  );
});

test("normalizes a bounded manifest chunk query", () => {
  assert.deepEqual(
    internalGetRankManifestChunkInput({
      workspaceId,
      projectId,
      jobId,
      manifestId,
      chunkIndex: "3"
    }),
    {
      workspaceId,
      projectId,
      jobId,
      manifestId,
      chunkIndex: 3
    }
  );
  assert.deepEqual(internalRankManifestChunkQuery({ jobId }), { jobId });

  assert.throws(
    () => internalRankManifestChunkQuery({ jobId, actorId }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalGetRankManifestChunkInput({
        workspaceId,
        projectId,
        jobId,
        manifestId,
        chunkIndex: "15000"
      }),
    BadRequestException
  );
});

function command() {
  return {
    workspaceId,
    projectId,
    actorId,
    jobId,
    estimateId,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    project: {
      id: projectId,
      workspaceId,
      domain: "example.com",
      status: "ACTIVE",
      version: 4
    },
    estimate: {
      trackingContextId,
      contextVersion: 3,
      configurationVersion: 2,
      configurationHash: {
        algorithm: "SHA_256",
        value: "a".repeat(64)
      },
      semanticScopeHash: {
        algorithm: "SHA_256",
        value: "b".repeat(64)
      },
      scopeHash: {
        algorithm: "SHA_256",
        value: "c".repeat(64)
      },
      pairCount: "2",
      expiresAt: "2026-07-29T12:05:00.000Z"
    },
    execution: {
      searchEngine: "GOOGLE",
      countryCode: "US",
      regionCode: "us-ca",
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
