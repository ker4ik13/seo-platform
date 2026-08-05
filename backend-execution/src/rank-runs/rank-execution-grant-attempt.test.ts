import assert from "node:assert/strict";
import test from "node:test";
import {
  rankExecutionGrantDecisionTransition,
  rankExecutionGrantHashes,
  rankExecutionGrantAttemptIdempotencyKey,
  storedRankExecutionGrantRequest
} from "./rank-execution-grant-attempt.js";
import type {
  InternalIssueRankExecutionGrantInputV1,
  InternalRankExecutionGrantDecisionV1
} from "@seo-platform/contracts";

const ids = Array.from(
  { length: 8 },
  (_, index) =>
    `01900000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`
);
const issuedAt = "2026-07-29T12:00:00.000Z";

test("derives one stable idempotency key and independent request/scope hashes", () => {
  const input = request();
  const hashes = rankExecutionGrantHashes(input);
  assert.equal(hashes.requestHash.length, 32);
  assert.equal(hashes.scopeHash.length, 32);
  assert.notDeepEqual(hashes.requestHash, hashes.scopeHash);
  assert.equal(
    rankExecutionGrantAttemptIdempotencyKey(input.jobItemId, 1),
    `rank-grant:${input.jobItemId}:1`
  );
  assert.deepEqual(storedRankExecutionGrantRequest(input), input);
});

test("validates the decision against local hashes and the database clock", () => {
  const input = request();
  const hashes = rankExecutionGrantHashes(input);
  const decision = granted(
    hashes.requestHash.toString("hex"),
    hashes.scopeHash.toString("hex")
  );
  assert.equal(
    rankExecutionGrantDecisionTransition(
      input,
      decision,
      new Date("2026-07-29T12:00:29.999Z")
    ).status,
    "GRANTED_PENDING_CONSUME"
  );
  assert.equal(
    rankExecutionGrantDecisionTransition(
      input,
      decision,
      new Date("2026-07-29T12:00:30.000Z")
    ).status,
    "EXPIRED"
  );
  assert.throws(
    () =>
      rankExecutionGrantDecisionTransition(
        input,
        {
          ...decision,
          requestHash: hash("f"),
          grant: { ...decision.grant, requestHash: hash("f") }
        },
        new Date("2026-07-29T12:00:01.000Z")
      ),
    /request hash mismatch/u
  );
  assert.throws(
    () =>
      rankExecutionGrantDecisionTransition(
        input,
        decision,
        new Date("2026-07-29T11:59:59.999Z")
      ),
    /decided in the future/u
  );
  assert.throws(
    () =>
      rankExecutionGrantDecisionTransition(
        input,
        {
          schemaVersion: "rank-execution-grant-decision@1",
          status: "DENIED",
          requestHash: {
            algorithm: "SHA_256",
            value: hashes.requestHash.toString("hex")
          },
          decidedAt: issuedAt,
          reason: "ENTITLEMENT_DENIED"
        },
        new Date("2026-07-29T11:59:59.999Z")
      ),
    /decided in the future/u
  );
});

function request(): InternalIssueRankExecutionGrantInputV1 {
  return {
    schemaVersion: "rank-execution-grant-request@1",
    workspaceId: ids[0] as string,
    projectId: ids[1] as string,
    actorId: ids[2] as string,
    membership: { id: ids[3] as string, version: 2 },
    project: { version: 3, domainHash: hash("a") },
    jobId: ids[4] as string,
    jobItemId: ids[5] as string,
    jobVersion: 4,
    executionAttempt: 1,
    purpose: "PROVIDER_SUBMIT",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    capability: "SERP_RANK_TRACKING",
    credentialMode: "BYOK_API_KEY",
    manifest: {
      id: ids[6] as string,
      hash: hash("b"),
      chunkIndex: 0
    },
    executionEvidenceHash: hash("c"),
    policyVersion: "manual-arsenkin-positions@1.0.0",
    usageIntent: { meter: "RANK_PROVIDER_TASK", quantity: "1" }
  };
}

function granted(
  requestHash: string,
  scopeHash: string
): InternalRankExecutionGrantDecisionV1 {
  return {
    schemaVersion: "rank-execution-grant-decision@1",
    status: "GRANTED",
    requestHash: { algorithm: "SHA_256", value: requestHash },
    decidedAt: issuedAt,
    grant: {
      schemaVersion: "rank-execution-grant@1",
      id: ids[7] as string,
      requestHash: { algorithm: "SHA_256", value: requestHash },
      scopeHash: { algorithm: "SHA_256", value: scopeHash },
      issuer: "PLATFORM_API",
      issuedAt,
      expiresAt: "2026-07-29T12:00:30.000Z"
    }
  };
}

function hash(character: string) {
  return {
    algorithm: "SHA_256" as const,
    value: character.repeat(64)
  };
}
