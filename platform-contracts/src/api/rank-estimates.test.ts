import assert from "node:assert/strict";
import test from "node:test";
import {
  rankEstimateBlockerCodes,
  rankEstimateCredentialFreshnessStatuses,
  rankEstimateCredentialModes,
  rankEstimateOperations,
  rankEstimateProviders,
  rankEstimateQuotaStatuses,
  rankEstimateScopeHashAvailabilities,
  rankEstimateStatuses,
  type InternalCreateRankEstimateInput,
  type InternalRankEstimateScope,
  type RankEstimate
} from "./rank-estimates.js";

const SHA_256_FIXTURE = "a".repeat(64);

const publicEstimateFixture = {
  id: "01900000-0000-7000-8000-000000000001",
  workspaceId: "01900000-0000-7000-8000-000000000002",
  projectId: "01900000-0000-7000-8000-000000000003",
  trackingContextId: "01900000-0000-7000-8000-000000000004",
  status: "BLOCKED",
  provider: "ARSENKIN",
  operation: "POSITIONS",
  credentialMode: "BYOK_API_KEY",
  scope: {
    keywordCount: "10",
    contextCount: "1",
    pairCount: "10",
    scopeHash: {
      availability: "AVAILABLE",
      algorithm: "SHA_256",
      value: SHA_256_FIXTURE
    },
    contextVersion: 3,
    configurationVersion: 2
  },
  workload: {
    taskCount: "1",
    minimumRequestCount: "3",
    pollingRequestCount: {
      status: "NOT_AVAILABLE"
    },
    requestStages: ["SET", "CHECK", "GET"],
    keywordLimitPerTask: "250",
    keywordLimitPerCommand: "1000",
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE"
  },
  providerLimits: {
    status: "NOT_AVAILABLE"
  },
  expectedDuration: {
    status: "NOT_AVAILABLE"
  },
  platformChargeMicro: "0",
  billingCurrency: "RUB",
  quota: {
    status: "NOT_AVAILABLE"
  },
  credentialFreshness: {
    status: "NOT_AVAILABLE"
  },
  retention: {
    normalizedRankHistory: "LONG_TERM",
    rawSerp: "NOT_COLLECTED"
  },
  blockers: [
    {
      code: "PROVIDER_CONTRACT_NOT_READY"
    },
    {
      code: "PROVIDER_EXECUTION_DISABLED"
    }
  ],
  executionAllowed: false,
  policyVersion: "arsenkin-positions-estimate.v1",
  calculatedAt: "2026-07-29T12:00:00.000Z",
  expiresAt: "2026-07-29T12:05:00.000Z"
} as const satisfies RankEstimate;

test("rank estimate finite vocabularies pin the provider-free first slice", () => {
  assert.deepEqual(rankEstimateStatuses, ["READY", "BLOCKED"]);
  assert.deepEqual(rankEstimateProviders, ["ARSENKIN"]);
  assert.deepEqual(rankEstimateOperations, ["POSITIONS"]);
  assert.deepEqual(rankEstimateCredentialModes, ["BYOK_API_KEY"]);
  assert.deepEqual(rankEstimateScopeHashAvailabilities, [
    "AVAILABLE",
    "UNAVAILABLE"
  ]);
  assert.deepEqual(rankEstimateQuotaStatuses, [
    "AVAILABLE",
    "EXHAUSTED",
    "NOT_AVAILABLE"
  ]);
  assert.deepEqual(rankEstimateCredentialFreshnessStatuses, [
    "FRESH",
    "STALE",
    "UNVERIFIED",
    "NOT_AVAILABLE"
  ]);
  assert.equal(publicEstimateFixture.workload.rawSerp, false);
  assert.equal(publicEstimateFixture.workload.fallbackMode, "NONE");
  assert.equal(publicEstimateFixture.platformChargeMicro, "0");
});

test("rank estimate blocker vocabulary covers every fail-closed boundary", () => {
  assert.deepEqual(rankEstimateBlockerCodes, [
    "CONTEXT_ARCHIVED",
    "NO_ASSIGNED_KEYWORDS",
    "KEYWORD_LIMIT_EXCEEDED",
    "SCOPE_HASH_UNAVAILABLE",
    "UNSUPPORTED_SEARCH_ENGINE",
    "UNSUPPORTED_DEPTH",
    "COUNTRY_MAPPING_UNVERIFIED",
    "REGION_MAPPING_UNVERIFIED",
    "LANGUAGE_MAPPING_UNVERIFIED",
    "SAFE_SEARCH_MAPPING_UNVERIFIED",
    "DOMAIN_MAPPING_UNVERIFIED",
    "BINDING_NOT_CONFIGURED",
    "BINDING_DISABLED",
    "BINDING_NOT_READY",
    "BINDING_ROUTE_UNSUPPORTED",
    "CREDENTIAL_NOT_ACTIVE",
    "CREDENTIAL_NOT_FRESH",
    "CREDENTIAL_PROVIDER_MISMATCH",
    "CREDENTIAL_MODE_UNSUPPORTED",
    "PROVIDER_CONTRACT_NOT_READY",
    "PROVIDER_EXECUTION_DISABLED",
    "ENTITLEMENT_NOT_AVAILABLE",
    "ENTITLEMENT_DENIED",
    "QUOTA_EXCEEDED",
    "MISSING_RUN_PERMISSION",
    "WORKSPACE_READ_ONLY",
    "WORKSPACE_SUSPENDED",
    "PROJECT_NOT_ACTIVE",
    "PROJECT_ARCHIVED"
  ]);
});

test("public rank estimate redacts private execution and provider fields", () => {
  const publicJson = JSON.stringify(publicEstimateFixture);
  const privateSentinels = [
    "binding-private",
    "credential-private",
    "material-private",
    "secret-project.example",
    "provider-payload-private"
  ];

  for (const sentinel of privateSentinels) {
    assert.equal(publicJson.includes(sentinel), false);
  }

  const forbiddenKeys = new Set([
    "bindingId",
    "credentialId",
    "credentialMaterialVersion",
    "materialVersion",
    "domain",
    "projectDomain",
    "providerPayload",
    "rawProviderPayload"
  ]);

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    if (value === null || typeof value !== "object") {
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `forbidden key: ${key}`);
      visit(child);
    }
  };

  visit(publicEstimateFixture);
});

test("not available quota and provider observations do not invent values", () => {
  assert.deepEqual(Object.keys(publicEstimateFixture.quota), ["status"]);
  assert.deepEqual(Object.keys(publicEstimateFixture.providerLimits), [
    "status"
  ]);
  assert.deepEqual(Object.keys(publicEstimateFixture.expectedDuration), [
    "status"
  ]);
});

test("internal boundaries carry trusted context but never keyword rows", () => {
  const input = {
    trackingContextId: "01900000-0000-7000-8000-000000000004",
    workspaceId: "01900000-0000-7000-8000-000000000002",
    projectId: "01900000-0000-7000-8000-000000000003",
    actorId: "01900000-0000-7000-8000-000000000005",
    project: {
      id: "01900000-0000-7000-8000-000000000003",
      workspaceId: "01900000-0000-7000-8000-000000000002",
      domain: "project.example",
      status: "ACTIVE",
      version: 7
    },
    access: {
      workspaceStatus: "ACTIVE",
      canRunRanking: true,
      entitlementStatus: "NOT_AVAILABLE"
    },
    billingCurrency: "RUB",
    quota: {
      status: "NOT_AVAILABLE"
    }
  } as const satisfies InternalCreateRankEstimateInput;

  const scope = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    trackingContextId: input.trackingContextId,
    contextStatus: "ACTIVE",
    contextVersion: 3,
    configurationVersion: 2,
    configurationHash: "b".repeat(64),
    configuration: {
      searchEngine: "GOOGLE",
      countryCode: "RU",
      regionCode: "213",
      regionLabel: "Moscow",
      language: "ru",
      device: "DESKTOP",
      depth: 30,
      domainMatchRule: {
        mode: "EXACT_HOST"
      },
      safeSearch: true
    },
    keywordCount: "10",
    contextCount: "1",
    pairCount: "10",
    semanticScopeHash: {
      availability: "AVAILABLE",
      algorithm: "SHA_256",
      value: SHA_256_FIXTURE
    },
    calculatedAt: "2026-07-29T12:00:00.000Z"
  } as const satisfies InternalRankEstimateScope;

  assert.equal("idempotencyKey" in input, false);
  assert.match(scope.semanticScopeHash.value, /^[a-f0-9]{64}$/u);

  const serializedScope = JSON.stringify(scope);
  assert.equal(serializedScope.includes("keywordId"), false);
  assert.equal(serializedScope.includes("textOriginal"), false);
  assert.equal(serializedScope.includes("providerPayload"), false);
});
