import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalJsonSha256 } from "../canonical-json.js";
import * as contracts from "../index.js";
import {
  internalSettleRankExecutionGrantInput,
  internalIssueRankExecutionGrantInput,
  internalRankExecutionGrantDecision,
  internalRankExecutionGrantSettlementResult,
  rankExecutionGrantDecisionSchemaVersion,
  rankExecutionGrantDecisionStatuses,
  rankExecutionGrantDenialReasons,
  rankExecutionGrantRequestHashDomain,
  rankExecutionGrantRequestHashPreimage,
  rankExecutionGrantRequestSchemaVersion,
  rankExecutionGrantSchemaVersion,
  rankExecutionGrantScopeHashDomain,
  rankExecutionGrantScopeHashPreimage,
  rankExecutionGrantScopeSchemaVersion,
  rankExecutionGrantSettlementRequestSchemaVersion,
  rankExecutionGrantSettlementResultSchemaVersion,
  rankEstimateProjectDomainHashDomain,
  rankEstimateProjectDomainHashPreimage,
  redactInternalRankExecutionGrantDecision,
  type InternalIssueRankExecutionGrantInputV1,
  type InternalRankExecutionGrantDecisionV1
} from "./rank-execution-grants.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const membershipId = "01900000-0000-7000-8000-000000000004";
const jobId = "01900000-0000-7000-8000-000000000005";
const jobItemId = "01900000-0000-7000-8000-000000000006";
const manifestId = "01900000-0000-7000-8000-000000000007";
const grantId = "01900000-0000-7000-8000-000000000008";
const issuedAt = "2026-07-29T12:00:00.000Z";
const expiresAt = "2026-07-29T12:00:30.000Z";

const hashA = hash("a");
const hashB = hash("b");
const hashC = hash("c");

test("exports the grant foundation from the public contracts entrypoint", () => {
  assert.equal(
    contracts.internalIssueRankExecutionGrantInput,
    internalIssueRankExecutionGrantInput
  );
  assert.equal(
    contracts.internalRankExecutionGrantDecision,
    internalRankExecutionGrantDecision
  );
  assert.equal(
    contracts.rankEstimateProjectDomainHashPreimage,
    rankEstimateProjectDomainHashPreimage
  );
});

test("pins the versioned grant vocabularies and independent hash domains", () => {
  assert.equal(
    rankExecutionGrantRequestSchemaVersion,
    "rank-execution-grant-request@1"
  );
  assert.equal(
    rankExecutionGrantScopeSchemaVersion,
    "rank-execution-grant-scope@1"
  );
  assert.equal(rankExecutionGrantSchemaVersion, "rank-execution-grant@1");
  assert.equal(
    rankExecutionGrantDecisionSchemaVersion,
    "rank-execution-grant-decision@1"
  );
  assert.equal(
    rankExecutionGrantSettlementRequestSchemaVersion,
    "rank-execution-grant-settlement-request@1"
  );
  assert.equal(
    rankExecutionGrantSettlementResultSchemaVersion,
    "rank-execution-grant-settlement-result@1"
  );
  assert.equal(
    rankExecutionGrantRequestHashDomain,
    "rank-execution-grant-request@1"
  );
  assert.equal(
    rankExecutionGrantScopeHashDomain,
    "rank-execution-grant-scope@1"
  );
  assert.notEqual(
    rankExecutionGrantRequestHashDomain,
    rankExecutionGrantScopeHashDomain
  );
  assert.deepEqual(rankExecutionGrantDecisionStatuses, [
    "GRANTED",
    "DENIED"
  ]);
  assert.deepEqual(rankExecutionGrantDenialReasons, [
    "WORKSPACE_NOT_ACTIVE",
    "PROJECT_NOT_ACTIVE",
    "PROJECT_VERSION_CHANGED",
    "MEMBERSHIP_NOT_ACTIVE",
    "MEMBERSHIP_VERSION_CHANGED",
    "RUN_PERMISSION_DENIED",
    "ENTITLEMENT_NOT_AVAILABLE",
    "ENTITLEMENT_DENIED",
    "QUOTA_NOT_AVAILABLE",
    "QUOTA_EXHAUSTED"
  ]);
});

test("strictly parses hold/capture requests and finite settlement results", () => {
  for (const action of ["HOLD", "CAPTURE", "RELEASE"] as const) {
    assert.deepEqual(
      internalSettleRankExecutionGrantInput({
        schemaVersion: "rank-execution-grant-settlement-request@1",
        action
      }),
      {
        schemaVersion: "rank-execution-grant-settlement-request@1",
        action
      }
    );
  }
  for (const status of [
    "RESERVED",
    "CAPTURED",
    "RELEASED",
    "NOT_APPLICABLE"
  ] as const) {
    assert.deepEqual(
      internalRankExecutionGrantSettlementResult({
        schemaVersion: "rank-execution-grant-settlement-result@1",
        grantId,
        status
      }),
      {
        schemaVersion: "rank-execution-grant-settlement-result@1",
        grantId,
        status
      }
    );
  }
  for (const candidate of [
    {
      schemaVersion: "rank-execution-grant-settlement-request@1",
      action: "OTHER"
    },
    {
      schemaVersion: "rank-execution-grant-settlement-request@1",
      action: "CAPTURE",
      amountMinor: "1"
    }
  ]) {
    assert.throws(
      () => internalSettleRankExecutionGrantInput(candidate),
      TypeError
    );
  }
  assert.throws(
    () =>
      internalRankExecutionGrantSettlementResult({
        schemaVersion: "rank-execution-grant-settlement-result@1",
        grantId,
        status: "OTHER"
      }),
    TypeError
  );
});

test("pins the existing project-domain SHA-256 byte recipe", () => {
  assert.equal(
    rankEstimateProjectDomainHashDomain,
    "seo-platform.rank-estimate.project-domain.v1\u0000"
  );
  assert.equal(
    rankEstimateProjectDomainHashPreimage("example.com"),
    "seo-platform.rank-estimate.project-domain.v1\u0000example.com"
  );
  assert.equal(
    rankEstimateProjectDomainHashPreimage(" Example.COM "),
    "seo-platform.rank-estimate.project-domain.v1\u0000 Example.COM "
  );
  assert.equal(
    createHash("sha256")
      .update(rankEstimateProjectDomainHashPreimage("example.com"), "utf8")
      .digest("hex"),
    "7bb9d1b31879e7a05b701c4afa2d373b381015cba94857888bee069900d117a2"
  );
  assert.throws(
    () => rankEstimateProjectDomainHashPreimage(null as unknown as string),
    TypeError
  );
});

test("strictly parses the exact fail-closed request shape", () => {
  const input = request();
  const parsed = internalIssueRankExecutionGrantInput(input);
  assert.deepEqual(parsed, input);
  assert.notEqual(parsed, input);
  assert.notEqual(parsed.membership, input.membership);
  assert.notEqual(parsed.project.domainHash, input.project.domainHash);
  assert.notEqual(parsed.manifest, input.manifest);

  const serialized = JSON.stringify(parsed);
  for (const forbidden of [
    "bindingId",
    "routeId",
    "credentialId",
    "ciphertext",
    "providerRequestId",
    "rawProviderResponse"
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }

  assert.equal(
    internalIssueRankExecutionGrantInput({
      ...input,
      credentialMode: "PLATFORM_PAID",
      usageIntent: {
        ...input.usageIntent,
        unitPriceMinor: "25"
      }
    }).credentialMode,
    "PLATFORM_PAID"
  );
});

test("request parser rejects malformed IDs, hashes, bounds and literals", () => {
  const valid = request();
  const invalid: readonly unknown[] = [
    { ...valid, credentialMode: "PLATFORM_PAID" },
    { ...valid, schemaVersion: "rank-execution-grant-request@2" },
    { ...valid, workspaceId: "01900000-0000-7000-8000-00000000000A" },
    { ...valid, projectId: "01900000-0000-6000-8000-000000000002" },
    { ...valid, membership: { ...valid.membership, version: 0 } },
    { ...valid, project: { ...valid.project, version: 1.5 } },
    {
      ...valid,
      project: {
        ...valid.project,
        domainHash: { algorithm: "SHA_512", value: "a".repeat(64) }
      }
    },
    { ...valid, jobVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, executionAttempt: 0 },
    { ...valid, executionAttempt: 1_001 },
    { ...valid, purpose: "CHECK_PROVIDER" },
    { ...valid, operation: "SERP" },
    { ...valid, capability: "SERP_COLLECTION" },
    { ...valid, credentialMode: "PLATFORM_INCLUDED" },
    { ...valid, manifest: { ...valid.manifest, chunkIndex: -1 } },
    { ...valid, manifest: { ...valid.manifest, chunkIndex: 300_000 } },
    {
      ...valid,
      executionEvidenceHash: { algorithm: "SHA_256", value: "A".repeat(64) }
    },
    { ...valid, policyVersion: "Invalid Policy" },
    { ...valid, policyVersion: `a${"b".repeat(64)}` },
    { ...valid, usageIntent: { meter: "KEYWORD", quantity: "1" } },
    { ...valid, usageIntent: { meter: "RANK_PROVIDER_TASK", quantity: "2" } }
  ];

  for (const candidate of invalid) {
    assert.throws(
      () => internalIssueRankExecutionGrantInput(candidate),
      TypeError
    );
  }
});

test("request parser rejects extra and non-data object properties", () => {
  const valid = request();
  assert.throws(
    () => internalIssueRankExecutionGrantInput({ ...valid, credentialId: grantId }),
    TypeError
  );
  assert.throws(
    () =>
      internalIssueRankExecutionGrantInput({
        ...valid,
        membership: { ...valid.membership, roleCode: "OWNER" }
      }),
    TypeError
  );
  assert.throws(
    () =>
      internalIssueRankExecutionGrantInput(
        Object.assign(Object.create({ inherited: true }), valid)
      ),
    TypeError
  );

  const withSymbol = request() as unknown as Record<PropertyKey, unknown>;
  withSymbol[Symbol("secret")] = "hidden";
  assert.throws(() => internalIssueRankExecutionGrantInput(withSymbol), TypeError);

  const withHidden = request() as unknown as Record<string, unknown>;
  Object.defineProperty(withHidden, "secret", {
    value: "hidden",
    enumerable: false
  });
  assert.throws(() => internalIssueRankExecutionGrantInput(withHidden), TypeError);

  let getterRead = false;
  const withGetter = request() as unknown as Record<string, unknown>;
  Object.defineProperty(withGetter, "workspaceId", {
    enumerable: true,
    get() {
      getterRead = true;
      return workspaceId;
    }
  });
  assert.throws(() => internalIssueRankExecutionGrantInput(withGetter), TypeError);
  assert.equal(getterRead, false);
});

test("hash preimage builders strip private extras and pin golden vectors", () => {
  const valid = request();
  const augmented = {
    ...valid,
    credentialId: "private-credential",
    project: {
      ...valid.project,
      ciphertext: "private-ciphertext"
    },
    manifest: {
      ...valid.manifest,
      keywordText: "private-keyword"
    }
  } as unknown as InternalIssueRankExecutionGrantInputV1;

  const requestPreimage = rankExecutionGrantRequestHashPreimage(augmented);
  const scopePreimage = rankExecutionGrantScopeHashPreimage(augmented);
  assert.deepEqual(requestPreimage, valid);
  assert.deepEqual(scopePreimage, {
    ...valid,
    schemaVersion: "rank-execution-grant-scope@1"
  });

  const serialized = JSON.stringify({ requestPreimage, scopePreimage });
  assert.equal(serialized.includes("private-credential"), false);
  assert.equal(serialized.includes("private-ciphertext"), false);
  assert.equal(serialized.includes("private-keyword"), false);

  const requestDigest = canonicalJsonSha256(
    rankExecutionGrantRequestHashDomain,
    requestPreimage
  );
  const scopeDigest = canonicalJsonSha256(
    rankExecutionGrantScopeHashDomain,
    scopePreimage
  );
  assert.equal(
    requestDigest,
    "30f7d28a79c772ef32003947f466a52a01cb97db726c9a4ddb2c5e314c7b9c13"
  );
  assert.equal(
    scopeDigest,
    "48761c51c62f8d933a93a273883763d73fd7b04f01b3153a2edefa0d4fab69d0"
  );
  assert.notEqual(requestDigest, scopeDigest);

  const reversed = Object.fromEntries(
    Object.entries(valid).reverse()
  );
  const reordered = internalIssueRankExecutionGrantInput(reversed);
  assert.equal(
    canonicalJsonSha256(
      rankExecutionGrantRequestHashDomain,
      rankExecutionGrantRequestHashPreimage(reordered)
    ),
    requestDigest
  );
});

test("strictly parses a granted decision and enforces its 30-second grant", () => {
  const input = grantedDecision();
  const parsed = internalRankExecutionGrantDecision(input);
  assert.deepEqual(parsed, input);
  assert.notEqual(parsed, input);
  assert.equal(parsed.status, "GRANTED");
  if (parsed.status !== "GRANTED") assert.fail("grant was not parsed");
  assert.notEqual(parsed.grant, input.grant);
  assert.equal(
    new Date(parsed.grant.expiresAt).getTime() -
      new Date(parsed.grant.issuedAt).getTime(),
    30_000
  );
});

test("strictly parses every finite denied decision", () => {
  for (const reason of rankExecutionGrantDenialReasons) {
    const decision = deniedDecision(reason);
    assert.deepEqual(internalRankExecutionGrantDecision(decision), decision);
  }
});

test("decision parser rejects cross-branch fields, drift and malformed evidence", () => {
  const granted = grantedDecision();
  const denied = deniedDecision("ENTITLEMENT_NOT_AVAILABLE");
  const invalid: readonly unknown[] = [
    { ...granted, schemaVersion: "rank-execution-grant-decision@2" },
    { ...granted, reason: "QUOTA_EXHAUSTED" },
    { ...granted, credentialId: grantId },
    { ...granted, requestHash: hash("d") },
    { ...granted, decidedAt: "2026-07-29T12:00:00Z" },
    { ...granted, decidedAt: "2026-07-29T12:00:00.001Z" },
    {
      ...granted,
      grant: { ...granted.grant, issuer: "JOBS_INTEGRATIONS" }
    },
    {
      ...granted,
      grant: {
        ...granted.grant,
        id: "01900000-0000-7000-8000-00000000000A"
      }
    },
    {
      ...granted,
      grant: { ...granted.grant, expiresAt: "2026-07-29T12:00:29.999Z" }
    },
    {
      ...granted,
      grant: { ...granted.grant, expiresAt: "2026-07-29T12:00:30.001Z" }
    },
    {
      ...granted,
      grant: { ...granted.grant, scopeHash: { ...hashB, credentialId: grantId } }
    },
    { ...denied, status: "BLOCKED" },
    { ...denied, reason: "PROVIDER_EXECUTION_DISABLED" },
    { ...denied, grant: granted.grant },
    { ...denied, requestHash: { algorithm: "SHA_256", value: "A".repeat(64) } }
  ];

  for (const candidate of invalid) {
    assert.throws(
      () => internalRankExecutionGrantDecision(candidate),
      TypeError
    );
  }

  let getterRead = false;
  const withStatusGetter = grantedDecision() as unknown as Record<string, unknown>;
  Object.defineProperty(withStatusGetter, "status", {
    enumerable: true,
    get() {
      getterRead = true;
      return "GRANTED";
    }
  });
  assert.throws(
    () => internalRankExecutionGrantDecision(withStatusGetter),
    TypeError
  );
  assert.equal(getterRead, false);
});

test("decision redactor removes private runtime diagnostics on both branches", () => {
  const granted = {
    ...grantedDecision(),
    credentialId: "private-credential",
    grant: {
      ...grantedDecision().grant,
      providerRequestId: "private-provider-request",
      requestHash: {
        ...hashA,
        rawProviderResponse: "private-provider-payload"
      }
    }
  } as unknown as InternalRankExecutionGrantDecisionV1;
  const denied = {
    ...deniedDecision("QUOTA_NOT_AVAILABLE"),
    internalDiagnostic: "private-diagnostic"
  } as unknown as InternalRankExecutionGrantDecisionV1;

  const redactedGranted = redactInternalRankExecutionGrantDecision(granted);
  const redactedDenied = redactInternalRankExecutionGrantDecision(denied);
  assert.deepEqual(redactedGranted, grantedDecision());
  assert.deepEqual(redactedDenied, deniedDecision("QUOTA_NOT_AVAILABLE"));

  const serialized = JSON.stringify({ redactedGranted, redactedDenied });
  for (const forbidden of [
    "private-credential",
    "private-provider-request",
    "private-provider-payload",
    "private-diagnostic",
    "credentialId",
    "providerRequestId",
    "rawProviderResponse",
    "internalDiagnostic"
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

function request(): InternalIssueRankExecutionGrantInputV1 {
  return {
    schemaVersion: "rank-execution-grant-request@1",
    workspaceId,
    projectId,
    actorId,
    membership: {
      id: membershipId,
      version: 3
    },
    project: {
      version: 7,
      domainHash: hashA
    },
    jobId,
    jobItemId,
    jobVersion: 5,
    executionAttempt: 1,
    purpose: "PROVIDER_SUBMIT",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    capability: "SERP_RANK_TRACKING",
    credentialMode: "BYOK_API_KEY",
    manifest: {
      id: manifestId,
      hash: hashB,
      chunkIndex: 2
    },
    executionEvidenceHash: hashC,
    policyVersion: "manual-arsenkin-positions@1.0.0",
    usageIntent: {
      meter: "RANK_PROVIDER_TASK",
      quantity: "1"
    }
  };
}

function grantedDecision(): Extract<
  InternalRankExecutionGrantDecisionV1,
  { readonly status: "GRANTED" }
> {
  return {
    schemaVersion: "rank-execution-grant-decision@1",
    status: "GRANTED",
    requestHash: hashA,
    decidedAt: issuedAt,
    grant: {
      schemaVersion: "rank-execution-grant@1",
      id: grantId,
      requestHash: hashA,
      scopeHash: hashB,
      issuer: "PLATFORM_API",
      issuedAt,
      expiresAt
    }
  };
}

function deniedDecision(
  reason: (typeof rankExecutionGrantDenialReasons)[number]
): Extract<
  InternalRankExecutionGrantDecisionV1,
  { readonly status: "DENIED" }
> {
  return {
    schemaVersion: "rank-execution-grant-decision@1",
    status: "DENIED",
    requestHash: hashA,
    decidedAt: issuedAt,
    reason
  };
}

function hash(character: string): {
  readonly algorithm: "SHA_256";
  readonly value: string;
} {
  return {
    algorithm: "SHA_256",
    value: character.repeat(64)
  };
}
