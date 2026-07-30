import assert from "node:assert/strict";
import test from "node:test";
import {
  ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION,
  rankExecutionEvidence,
  rankExecutionEvidenceHash,
  type RankExecutionEvidenceV2
} from "./rank-execution-evidence.js";

const ids = Array.from(
  { length: 10 },
  (_, index) =>
    `01900000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`
);

test("hashes only the exact private execution evidence allowlist", () => {
  const value = evidence();
  const parsed = rankExecutionEvidence(value);

  assert.deepEqual(parsed, value);
  assert.equal(
    rankExecutionEvidenceHash(value).value,
    rankExecutionEvidenceHash(parsed).value
  );
  assert.equal(
    parsed.executionConnectorVersion,
    ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION
  );
  const serialized = JSON.stringify(parsed);
  for (const forbidden of [
    "ciphertext",
    "encryptedDataKey",
    "apiKey",
    "providerPayload"
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("rejects extensible, disabled and malformed execution evidence", () => {
  const value = evidence();
  for (const candidate of [
    { ...value, apiKey: "must-not-cross" },
    { ...value, executionAttempt: 0 },
    {
      ...value,
      manifest: { ...value.manifest, chunkIndex: 4 }
    },
    {
      ...value,
      providerRequestIntent: {
        ...value.providerRequestIntent,
        schemaVersion: "rank-provider-request-intent@2"
      }
    },
    {
      ...value,
      credential: {
        ...value.credential,
        verifiedAt: "2026-07-29T12:00:00Z"
      }
    },
    {
      ...value,
      killSwitch: { enabled: false, version: "arsenkin-positions@1" }
    },
    {
      ...value,
      killSwitch: { enabled: true, version: "INVALID VERSION" }
    }
  ]) {
    assert.throws(() => rankExecutionEvidence(candidate), TypeError);
  }
});

function evidence(): RankExecutionEvidenceV2 {
  return {
    schemaVersion: "rank-execution-evidence@2",
    workspaceId: ids[0] as string,
    projectId: ids[1] as string,
    jobId: ids[2] as string,
    jobItemId: ids[3] as string,
    executionAttempt: 1,
    estimateId: ids[4] as string,
    manifest: {
      id: ids[5] as string,
      hash: hash("a"),
      chunkIndex: 0
    },
    providerRequestIntent: {
      id: ids[9] as string,
      schemaVersion: "rank-provider-request-intent@1",
      requestHash: hash("c"),
      manifestChunkHash: hash("d")
    },
    binding: {
      id: ids[6] as string,
      version: 2
    },
    route: { id: ids[7] as string },
    credential: {
      id: ids[8] as string,
      version: 3,
      materialVersion: 4,
      validationId: ids[4] as string,
      validationVersion: 5,
      validationConnectorVersion: "arsenkin@1.0.0",
      verifiedAt: "2026-07-29T12:00:00.000Z"
    },
    estimateExecutionHash: hash("b"),
    executionConnectorVersion:
      ARSENKIN_RANK_EXECUTION_CONNECTOR_VERSION,
    providerPolicyVersion: "manual-arsenkin-positions@1.0.0",
    killSwitch: {
      enabled: true,
      version: "arsenkin-positions@1"
    }
  };
}

function hash(character: string) {
  return {
    algorithm: "SHA_256" as const,
    value: character.repeat(64)
  };
}
