import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { scopedRankEstimate } from "./rank-estimate-response.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const contextId = "01900000-0000-7000-8000-000000000003";

const blockedEstimate = {
  id: "01900000-0000-7000-8000-000000000004",
  workspaceId,
  projectId,
  trackingContextId: contextId,
  status: "BLOCKED",
  provider: "ARSENKIN",
  operation: "POSITIONS",
  credentialMode: "BYOK_API_KEY",
  scope: {
    keywordCount: "251",
    contextCount: "1",
    pairCount: "251",
    scopeHash: {
      availability: "AVAILABLE",
      algorithm: "SHA_256",
      value: "a".repeat(64)
    },
    contextVersion: 3,
    configurationVersion: 2
  },
  workload: {
    taskCount: "2",
    minimumRequestCount: "6",
    pollingRequestCount: { status: "NOT_AVAILABLE" },
    requestStages: ["SET", "CHECK", "GET"],
    keywordLimitPerTask: "250",
    keywordLimitPerCommand: "1000",
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE"
  },
  providerLimits: { status: "NOT_AVAILABLE" },
  expectedDuration: { status: "NOT_AVAILABLE" },
  platformChargeMicro: "0",
  billingCurrency: "RUB",
  quota: { status: "NOT_AVAILABLE" },
  credentialFreshness: { status: "NOT_AVAILABLE" },
  retention: {
    normalizedRankHistory: "LONG_TERM",
    rawSerp: "NOT_COLLECTED"
  },
  blockers: [
    { code: "PROVIDER_CONTRACT_NOT_READY" },
    { code: "PROVIDER_EXECUTION_DISABLED" }
  ],
  executionAllowed: false,
  policyVersion: "arsenkin-positions@1",
  calculatedAt: "2026-07-29T12:00:00.000Z",
  expiresAt: "2026-07-29T12:05:00.000Z"
} as const;

test("strictly maps a Jobs-owned scoped, redacted rank estimate", () => {
  assert.deepEqual(
    scopedRankEstimate(
      blockedEstimate,
      workspaceId,
      projectId,
      contextId
    ),
    blockedEstimate
  );
});

test("maps unlimited BYOK rank allowance without invented quota values", () => {
  const unlimited = {
    ...blockedEstimate,
    quota: { status: "UNLIMITED" }
  } as const;
  assert.deepEqual(
    scopedRankEstimate(unlimited, workspaceId, projectId, contextId).quota,
    { status: "UNLIMITED" }
  );
});

test("preserves the exact competitor estimate policy from Jobs", () => {
  const competitorEstimate = {
    ...blockedEstimate,
    purpose: "COMPETITOR_SERP",
    saveProjectPosition: false
  } as const;

  const result = scopedRankEstimate(
    competitorEstimate,
    workspaceId,
    projectId,
    contextId
  );

  assert.equal(result.purpose, "COMPETITOR_SERP");
  assert.equal(result.saveProjectPosition, false);
  assert.throws(
    () => scopedRankEstimate(
      { ...competitorEstimate, saveProjectPosition: undefined },
      workspaceId,
      projectId,
      contextId
    ),
    invalidDependencyResponse
  );
});

test("rejects secret projections and cross-tenant responses", () => {
  for (const value of [
    { ...blockedEstimate, credentialId: contextId },
    {
      ...blockedEstimate,
      workspaceId: "01900000-0000-7000-8000-000000000099"
    }
  ]) {
    assert.throws(
      () =>
        scopedRankEstimate(value, workspaceId, projectId, contextId),
      invalidDependencyResponse
    );
  }
});

test("rejects contradictory status, workload and expiry invariants", () => {
  for (const value of [
    { ...blockedEstimate, status: "READY" },
    {
      ...blockedEstimate,
      workload: { ...blockedEstimate.workload, taskCount: "1" }
    },
    {
      ...blockedEstimate,
      expiresAt: "2026-07-29T12:06:00.000Z"
    },
    {
      ...blockedEstimate,
      blockers: [
        blockedEstimate.blockers[0],
        blockedEstimate.blockers[0]
      ]
    }
  ]) {
    assert.throws(
      () =>
        scopedRankEstimate(value, workspaceId, projectId, contextId),
      invalidDependencyResponse
    );
  }
});

test("accepts the bounded overflow sentinel only with unavailable hash", () => {
  const overflow = {
    ...blockedEstimate,
    scope: {
      ...blockedEstimate.scope,
      keywordCount: "1001",
      pairCount: "1001",
      scopeHash: { availability: "UNAVAILABLE" }
    },
    workload: {
      ...blockedEstimate.workload,
      taskCount: "0",
      minimumRequestCount: "0"
    },
    blockers: [
      { code: "KEYWORD_LIMIT_EXCEEDED" },
      { code: "SCOPE_HASH_UNAVAILABLE" }
    ]
  };

  assert.equal(
    scopedRankEstimate(
      overflow,
      workspaceId,
      projectId,
      contextId
    ).scope.keywordCount,
    "1001"
  );
});

test("accepts one 15,000-keyword provider task and rejects a wider scope", () => {
  const current = {
    ...blockedEstimate,
    scope: {
      ...blockedEstimate.scope,
      keywordCount: "15000",
      pairCount: "15000"
    },
    workload: {
      ...blockedEstimate.workload,
      taskCount: "1",
      minimumRequestCount: "3",
      keywordLimitPerTask: "15000",
      keywordLimitPerCommand: "15000"
    }
  };
  assert.equal(
    scopedRankEstimate(current, workspaceId, projectId, contextId).workload
      .taskCount,
    "1"
  );

  const overflow = {
    ...current,
    scope: {
      ...current.scope,
      keywordCount: "15001",
      pairCount: "15001",
      scopeHash: { availability: "UNAVAILABLE" }
    },
    workload: {
      ...current.workload,
      taskCount: "0",
      minimumRequestCount: "0"
    },
    blockers: [
      { code: "KEYWORD_LIMIT_EXCEEDED" },
      { code: "SCOPE_HASH_UNAVAILABLE" }
    ]
  };
  assert.equal(
    scopedRankEstimate(overflow, workspaceId, projectId, contextId).scope
      .keywordCount,
    "15001"
  );
  assert.throws(
    () =>
      scopedRankEstimate(
        {
          ...overflow,
          scope: {
            ...overflow.scope,
            keywordCount: "15002",
            pairCount: "15002"
          }
        },
        workspaceId,
        projectId,
        contextId
      ),
    invalidDependencyResponse
  );
});

test("accepts XMLStock Yandex and Google workloads without truncating requests", () => {
  const xmlBase = {
    ...blockedEstimate,
    provider: "XMLSTOCK",
    scope: {
      ...blockedEstimate.scope,
      keywordCount: "15000",
      pairCount: "15000"
    },
    workload: {
      ...blockedEstimate.workload,
      taskCount: "15000",
      minimumRequestCount: "30000",
      requestStages: ["SUBMIT", "POLL"],
      keywordLimitPerTask: "1",
      keywordLimitPerCommand: "15000"
    },
    policyVersion: "manual-xmlstock-serp@1.0.0"
  };
  assert.equal(
    scopedRankEstimate(xmlBase, workspaceId, projectId, contextId).provider,
    "XMLSTOCK"
  );
  const google = {
    ...xmlBase,
    workload: {
      ...xmlBase.workload,
      minimumRequestCount: "150000",
      requestStages: ["GET"]
    }
  };
  assert.equal(
    scopedRankEstimate(google, workspaceId, projectId, contextId).workload
      .minimumRequestCount,
    "150000"
  );
  assert.throws(
    () => scopedRankEstimate({
      ...google,
      workload: { ...google.workload, minimumRequestCount: "150001" }
    }, workspaceId, projectId, contextId),
    invalidDependencyResponse
  );
});

function invalidDependencyResponse(error: unknown): boolean {
  return (
    error instanceof DomainError &&
    error.statusCode === 502 &&
    error.code === "DEPENDENCY_UNAVAILABLE"
  );
}
