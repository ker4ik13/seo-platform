import assert from "node:assert/strict";
import test from "node:test";
import type { InternalSealRankManifestInput } from "@seo-platform/contracts";
import {
  rankManifestCommandHash,
  rankManifestCommandJson,
  storedRankManifestCommand
} from "./rank-manifest-command.js";

const command = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  jobId: "01900000-0000-7000-8000-000000000004",
  estimateId: "01900000-0000-7000-8000-000000000005",
  provider: "ARSENKIN",
  operation: "POSITIONS",
  project: {
    id: "01900000-0000-7000-8000-000000000002",
    workspaceId: "01900000-0000-7000-8000-000000000001",
    domain: "example.com",
    status: "ACTIVE",
    version: 4
  },
  estimate: {
    trackingContextId: "01900000-0000-7000-8000-000000000006",
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
} as const satisfies InternalSealRankManifestInput;

const binding = {
  workspaceId: command.workspaceId,
  projectId: command.projectId,
  actorId: command.actorId,
  jobId: command.jobId,
  estimateId: command.estimateId,
  trackingContextId: command.estimate.trackingContextId,
  projectDomain: command.project.domain,
  projectVersion: command.project.version,
  pairCount: 2n
};

test("round-trips one exact immutable recovery command", () => {
  const digest = rankManifestCommandHash(command);
  const stored = rankManifestCommandJson(command);
  assert.deepEqual(
    storedRankManifestCommand(stored, digest, binding),
    command
  );
  assert.equal(
    digest.toString("hex"),
    "196e90a4ed3b22e6c7b9bec422f2192fcb6224d38b4f031857f7c76ced2c1d03"
  );
});

test("rejects changed commands, hashes and extensible payloads", () => {
  const digest = rankManifestCommandHash(command);
  assert.throws(
    () =>
      storedRankManifestCommand(
        { ...command, estimateId: command.jobId },
        digest,
        binding
      ),
    /Invalid immutable/u
  );
  assert.throws(
    () =>
      storedRankManifestCommand(
        { ...command, secret: "must-not-pass" },
        digest,
        binding
      ),
    /Invalid immutable/u
  );
  assert.throws(
    () =>
      storedRankManifestCommand(command, Buffer.alloc(32), binding),
    /Invalid immutable/u
  );
});

test("round-trips a continuation command bound to its missing pair count", () => {
  const retry = {
    ...command,
    retryOfJobId: "01900000-0000-7000-8000-000000000007",
    estimate: { ...command.estimate, pairCount: "1" }
  } as const satisfies InternalSealRankManifestInput;
  const retryBinding = { ...binding, pairCount: 1n };
  assert.deepEqual(
    storedRankManifestCommand(
      rankManifestCommandJson(retry),
      rankManifestCommandHash(retry),
      retryBinding
    ),
    retry
  );
});

test("round-trips the XMLStock Turbo depth mode before provider submission", () => {
  const turbo = {
    ...command,
    provider: "XMLSTOCK",
    providerPolicyVersion: "manual-xmlstock-serp@2.0.0",
    execution: {
      ...command.execution,
      searchEngine: "YANDEX",
      countryCode: "RU",
      regionCode: "213",
      language: "ru",
      depth: 50,
      xmlStockDepthMode: "STRICT_DEPTH",
      providerMappingVersion: "xmlstock-yandex-live@3"
    }
  } as const satisfies InternalSealRankManifestInput;

  assert.deepEqual(
    storedRankManifestCommand(
      rankManifestCommandJson(turbo),
      rankManifestCommandHash(turbo),
      binding
    ),
    turbo
  );
});

test("rejects a self-consistent command bound to another Job graph", () => {
  const digest = rankManifestCommandHash(command);

  for (const mismatch of [
    { ...binding, workspaceId: command.actorId },
    { ...binding, projectId: command.actorId },
    { ...binding, actorId: command.projectId },
    { ...binding, jobId: command.estimateId },
    { ...binding, estimateId: command.jobId },
    { ...binding, trackingContextId: command.actorId },
    { ...binding, projectDomain: "other.example" },
    { ...binding, projectVersion: 5 },
    { ...binding, pairCount: 3n }
  ]) {
    assert.throws(
      () => storedRankManifestCommand(command, digest, mismatch),
      /Invalid immutable/u
    );
  }
});

function hash(value: string) {
  return {
    algorithm: "SHA_256" as const,
    value: value.repeat(64)
  };
}
