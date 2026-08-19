import assert from "node:assert/strict";
import test from "node:test";
import {
  rankEstimateBlockerCodes,
  type RankEstimate,
  type TrackingContextSummary
} from "@seo-platform/contracts";
import { BrowserApiError } from "./browser-api.ts";
import {
  parseRankEstimate,
  rankEstimateBlockerLabel,
  rankEstimateBlockerTitle,
  rankEstimateCommandSignature,
  rankEstimateContextSignature,
  rankEstimateCountLabel,
  rankEstimateCredentialFreshnessLabel,
  rankEstimateExpired,
  rankEstimateExpiryDelay,
  rankEstimateFeedback,
  rankEstimateIdempotencyCommand,
  rankEstimatePayloadSignature,
  rankEstimateQuotaLabel,
  rankEstimatesApiPath,
  rankEstimateShortHash
} from "./rank-estimates.ts";

const hash = "a".repeat(64);

const estimate: RankEstimate = {
  id: "estimate-1",
  workspaceId: "workspace-1",
  projectId: "project-1",
  trackingContextId: "context-1",
  status: "BLOCKED",
  provider: "ARSENKIN",
  operation: "POSITIONS",
  credentialMode: "BYOK_API_KEY",
  scope: {
    keywordCount: "1000",
    contextCount: "1",
    pairCount: "1000",
    scopeHash: {
      availability: "AVAILABLE",
      algorithm: "SHA_256",
      value: hash
    },
    contextVersion: 3,
    configurationVersion: 3
  },
  workload: {
    taskCount: "4",
    minimumRequestCount: "12",
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
  credentialFreshness: { status: "UNVERIFIED" },
  retention: {
    normalizedRankHistory: "LONG_TERM",
    rawSerp: "NOT_COLLECTED"
  },
  blockers: [{ code: "PROVIDER_CONTRACT_NOT_READY" }],
  executionAllowed: false,
  policyVersion: "arsenkin-positions.v1",
  calculatedAt: "2026-07-29T12:00:00.000Z",
  expiresAt: "2026-07-29T12:05:00.000Z"
};

const context: TrackingContextSummary = {
  id: "context-1",
  workspaceId: "workspace-1",
  projectId: "project-1",
  name: "Google Desktop",
  status: "ACTIVE",
  configuration: {
    searchEngine: "GOOGLE",
    countryCode: "RU",
    language: "ru",
    device: "DESKTOP",
    depth: 30,
    domainMatchRule: { mode: "EXACT_HOST" },
    safeSearch: false,
    configurationVersion: 3,
    createdBy: "user-1",
    createdAt: "2026-07-29T10:00:00.000Z"
  },
  assignedKeywordCount: 1000,
  version: 3,
  createdBy: "user-1",
  updatedBy: "user-1",
  createdAt: "2026-07-29T10:00:00.000Z",
  updatedAt: "2026-07-29T11:00:00.000Z"
};

test("parses and narrows a valid public rank estimate", () => {
  const parsed = parseRankEstimate(
    {
      ...estimate,
      ignoredInternalField: {
        credentialId: "must-not-be-present-in-result"
      }
    },
    {
      projectId: "project-1",
      trackingContextId: "context-1"
    }
  );

  assert.deepEqual(parsed, estimate);
  assert.equal("ignoredInternalField" in parsed, false);
});

test("rejects cross-project, malformed and contradictory estimates", () => {
  assert.throws(
    () =>
      parseRankEstimate(
        { ...estimate, projectId: "other-project" },
        {
          projectId: "project-1",
          trackingContextId: "context-1"
        }
      ),
    (error: unknown) =>
      error instanceof BrowserApiError &&
      error.code === "INVALID_RESPONSE"
  );
  assert.throws(() =>
    parseRankEstimate(
      {
        ...estimate,
        scope: {
          ...estimate.scope,
          scopeHash: {
            availability: "AVAILABLE",
            algorithm: "SHA_256",
            value: "not-a-sha256"
          }
        }
      },
      {
        projectId: "project-1",
        trackingContextId: "context-1"
      }
    )
  );
  assert.throws(() =>
    parseRankEstimate(
      {
        ...estimate,
        scope: {
          ...estimate.scope,
          contextVersion: 2,
          configurationVersion: 3
        }
      },
      {
        projectId: "project-1",
        trackingContextId: "context-1"
      }
    )
  );
  assert.throws(() =>
    parseRankEstimate(
      {
        ...estimate,
        workload: {
          ...estimate.workload,
          taskCount: "3"
        }
      },
      {
        projectId: "project-1",
        trackingContextId: "context-1"
      }
    )
  );
  assert.throws(() =>
    parseRankEstimate(
      {
        ...estimate,
        blockers: [
          { code: "PROVIDER_EXECUTION_DISABLED" },
          { code: "PROVIDER_CONTRACT_NOT_READY" }
        ]
      },
      {
        projectId: "project-1",
        trackingContextId: "context-1"
      }
    )
  );
  assert.throws(() =>
    parseRankEstimate(
      {
        ...estimate,
        status: "READY",
        executionAllowed: true
      },
      {
        projectId: "project-1",
        trackingContextId: "context-1"
      }
    )
  );
});

test("renders bounded overflow and unavailable hash honestly", () => {
  assert.equal(rankEstimateCountLabel("1001"), "более 1 000");
  assert.equal(rankEstimateCountLabel("1000"), "1 000");
  assert.equal(rankEstimateCountLabel("15001"), "более 15 000");
  assert.equal(rankEstimateCountLabel("15000"), "15 000");
  assert.equal(
    rankEstimateShortHash({ availability: "UNAVAILABLE" }),
    "Недоступен"
  );
  assert.equal(
    rankEstimateShortHash({
      availability: "AVAILABLE",
      algorithm: "SHA_256",
      value: hash
    }),
    "aaaaaaaaaaaa…aaaaaaaa"
  );
});

test("parses one 15,000-keyword Arsenkin positions task", () => {
  const current = {
    ...estimate,
    scope: {
      ...estimate.scope,
      keywordCount: "15000",
      pairCount: "15000"
    },
    workload: {
      ...estimate.workload,
      taskCount: "1",
      minimumRequestCount: "3",
      keywordLimitPerTask: "15000",
      keywordLimitPerCommand: "15000"
    }
  };

  assert.equal(
    parseRankEstimate(current, {
      projectId: "project-1",
      trackingContextId: "context-1"
    }).scope.keywordCount,
    "15000"
  );
});

test("parses XMLStock Yandex and Google Top-100 workloads", () => {
  const xmlBase = {
    ...estimate,
    provider: "XMLSTOCK",
    scope: {
      ...estimate.scope,
      keywordCount: "15000",
      pairCount: "15000"
    },
    workload: {
      ...estimate.workload,
      taskCount: "15000",
      minimumRequestCount: "30000",
      requestStages: ["SUBMIT", "POLL"],
      keywordLimitPerTask: "1",
      keywordLimitPerCommand: "15000"
    },
    policyVersion: "manual-xmlstock-serp@1.0.0"
  };
  assert.equal(
    parseRankEstimate(xmlBase, {
      projectId: "project-1",
      trackingContextId: "context-1"
    }).provider,
    "XMLSTOCK"
  );
  assert.equal(
    parseRankEstimate({
      ...xmlBase,
      workload: {
        ...xmlBase.workload,
        minimumRequestCount: "150000",
        requestStages: ["GET"]
      }
    }, {
      projectId: "project-1",
      trackingContextId: "context-1"
    }).workload.minimumRequestCount,
    "150000"
  );
});

test("has a user-facing Russian explanation for every blocker", () => {
  for (const code of rankEstimateBlockerCodes) {
    assert.ok(rankEstimateBlockerTitle(code).length > 5, code);
    assert.ok(rankEstimateBlockerLabel(code).length > 20, code);
  }
});

test("maps quota and credential freshness without inventing data", () => {
  assert.equal(
    rankEstimateQuotaLabel({ status: "UNLIMITED" }),
    "Без внутреннего лимита"
  );
  assert.equal(
    rankEstimateQuotaLabel({ status: "NOT_AVAILABLE" }),
    "Тарифная квота пока не подключена"
  );
  assert.match(
    rankEstimateQuotaLabel({
      status: "EXHAUSTED",
      limit: "1000",
      used: "1000",
      remaining: "0"
    }),
    /Квота исчерпана/u
  );
  assert.equal(
    rankEstimateCredentialFreshnessLabel({
      status: "NOT_AVAILABLE"
    }),
    "Данные об API-ключе недоступны"
  );
});

test("uses project-safe paths and context-only request payload", () => {
  assert.equal(
    rankEstimatesApiPath("project/one"),
    "/app/api/projects/project%2Fone/rank-estimates"
  );
  assert.equal(
    rankEstimatePayloadSignature("context-1"),
    '{"trackingContextId":"context-1"}'
  );
  assert.equal(
    rankEstimatePayloadSignature(
      "context-1",
      "XMLSTOCK",
      "credential-1",
      "LIVE",
      "TURBO"
    ),
    '{"trackingContextId":"context-1","provider":"XMLSTOCK","credentialId":"credential-1","searchSource":"LIVE","yandexLiveMode":"TURBO"}'
  );
});

test("context signature invalidates estimates after relevant revisions", () => {
  assert.notEqual(
    rankEstimateContextSignature(context),
    rankEstimateContextSignature({
      ...context,
      assignedKeywordCount: 1001
    })
  );
  assert.notEqual(
    rankEstimateContextSignature(context),
    rankEstimateContextSignature({
      ...context,
      configuration: {
        ...context.configuration,
        configurationVersion: 4
      }
    })
  );
  assert.notEqual(
    rankEstimateContextSignature(context),
    rankEstimateContextSignature({
      ...context,
      status: "ARCHIVED"
    })
  );
  assert.notEqual(
    rankEstimateCommandSignature(context),
    rankEstimateCommandSignature({
      ...context,
      version: 4
    })
  );
});

test("reuses ambiguous estimate retries and rotates explicit recalculations", () => {
  const first = rankEstimateIdempotencyCommand(
    undefined,
    context,
    false,
    () => "estimate-key-1"
  );
  const ambiguousRetry = rankEstimateIdempotencyCommand(
    first,
    context,
    false,
    () => "estimate-key-2"
  );
  const explicitRecalculation = rankEstimateIdempotencyCommand(
    ambiguousRetry,
    context,
    true,
    () => "estimate-key-3"
  );
  const revisedContext = rankEstimateIdempotencyCommand(
    ambiguousRetry,
    { ...context, assignedKeywordCount: 999 },
    false,
    () => "estimate-key-4"
  );

  assert.equal(ambiguousRetry.key, "estimate-key-1");
  assert.equal(explicitRecalculation.key, "estimate-key-3");
  assert.equal(revisedContext.key, "estimate-key-4");
  const otherProvider = rankEstimateIdempotencyCommand(
    first,
    context,
    false,
    () => "estimate-key-xmlstock",
    "XMLSTOCK"
  );
  assert.equal(otherProvider.key, "estimate-key-xmlstock");
  const turbo = rankEstimateIdempotencyCommand(
    otherProvider,
    context,
    false,
    () => "estimate-key-turbo",
    "XMLSTOCK",
    "credential-1",
    "LIVE",
    "TURBO"
  );
  assert.equal(turbo.key, "estimate-key-turbo");
});

test("expiry helpers schedule a bounded transition to expired", () => {
  const now = Date.parse("2026-07-29T12:00:00.000Z");
  assert.equal(
    rankEstimateExpiryDelay("2026-07-29T12:05:00.000Z", now),
    300_000
  );
  assert.equal(
    rankEstimateExpired("2026-07-29T12:05:00.000Z", now),
    false
  );
  assert.equal(
    rankEstimateExpired("2026-07-29T12:00:00.000Z", now),
    true
  );
});

test("distinguishes retry-safe and permission failures", () => {
  const recoverable = rankEstimateFeedback(
    new BrowserApiError(
      503,
      "DEPENDENCY_UNAVAILABLE",
      "temporary",
      [],
      "request-1",
      true
    ),
    true
  );
  assert.equal(recoverable.retryable, true);
  assert.equal(recoverable.requestId, "request-1");

  const forbidden = rankEstimateFeedback(
    new BrowserApiError(403, "FORBIDDEN", "forbidden"),
    true
  );
  assert.equal(forbidden.kind, "forbidden");
  assert.equal(forbidden.retryable, false);

  const offline = rankEstimateFeedback(new TypeError("network"), true);
  assert.equal(offline.kind, "offline");
  assert.equal(offline.retryable, true);
});
