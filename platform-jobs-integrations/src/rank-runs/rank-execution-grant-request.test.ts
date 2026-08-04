import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRankExecutionGrantRequest,
  type RankExecutionGrantRequestFacts
} from "./rank-execution-grant-request.js";

const ids = Array.from(
  { length: 13 },
  (_, index) =>
    `01900000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`
);

test("builds the exact public grant request from private evidence", () => {
  const built = buildRankExecutionGrantRequest(facts());

  assert.equal(built.request.workspaceId, ids[0]);
  assert.equal(built.request.projectId, ids[1]);
  assert.equal(built.request.jobVersion, 11);
  assert.equal(built.request.executionAttempt, 2);
  assert.equal(
    built.request.executionEvidenceHash.value,
    built.evidenceHash.value
  );
  assert.equal(built.evidence.credential.id, ids[10]);
  assert.equal(built.evidence.providerRequestIntent.id, ids[12]);
  assert.equal(built.evidence.killSwitch.enabled, true);

  const requestJson = JSON.stringify(built.request);
  for (const privateValue of [
    ids[8],
    ids[9],
    ids[10],
    ids[11],
    ids[12]
  ]) {
    assert.equal(requestJson.includes(privateValue as string), false);
  }
});

test("binds material, validation and kill-switch versions independently", () => {
  const baseline = buildRankExecutionGrantRequest(facts());
  for (const override of [
    { credentialMaterialVersion: 5 },
    { credentialValidationVersion: 6 },
    { killSwitchVersion: "arsenkin-positions@2" },
    { providerRequestIntentHash: Buffer.alloc(32, 9) },
    { manifestChunkHash: Buffer.alloc(32, 8) }
  ]) {
    const changed = buildRankExecutionGrantRequest({
      ...facts(),
      ...override
    });
    assert.notEqual(
      changed.evidenceHash.value,
      baseline.evidenceHash.value
    );
  }
});

test("rejects malformed binary evidence before building a request", () => {
  assert.throws(
    () =>
      buildRankExecutionGrantRequest({
        ...facts(),
        manifestHash: Buffer.alloc(31)
      }),
    /Invalid rank execution evidence hash/u
  );
});

function facts(): RankExecutionGrantRequestFacts {
  return {
    provider: "ARSENKIN",
    workspaceId: ids[0] as string,
    projectId: ids[1] as string,
    actorId: ids[2] as string,
    membershipId: ids[3] as string,
    membershipVersion: 4,
    projectVersion: 7,
    projectDomainHash: Buffer.alloc(32, 1),
    jobId: ids[4] as string,
    jobItemId: ids[5] as string,
    jobVersion: 11,
    executionAttempt: 2,
    estimateId: ids[6] as string,
    manifestId: ids[7] as string,
    manifestHash: Buffer.alloc(32, 2),
    manifestChunkIndex: 1,
    providerRequestIntentId: ids[12] as string,
    providerRequestIntentHash: Buffer.alloc(32, 4),
    manifestChunkHash: Buffer.alloc(32, 5),
    bindingId: ids[8] as string,
    bindingVersion: 3,
    routeId: ids[9] as string,
    credentialId: ids[10] as string,
    credentialVersion: 4,
    credentialMaterialVersion: 4,
    credentialValidationId: ids[11] as string,
    credentialValidationVersion: 5,
    credentialValidationConnectorVersion: "arsenkin@1.0.0",
    credentialVerifiedAt: new Date("2026-07-29T12:00:00.000Z"),
    estimateExecutionHash: Buffer.alloc(32, 3),
    providerPolicyVersion: "manual-arsenkin-positions@1.0.0",
    killSwitchVersion: "arsenkin-positions@1"
  };
}
