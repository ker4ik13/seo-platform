import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { scopedRankJobSummary } from "./rank-job-response.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const contextId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";

const preparing = {
  id: jobId,
  workspaceId,
  projectId,
  trackingContextId: contextId,
  type: "MANUAL_RANK_CHECK",
  provider: "ARSENKIN",
  operation: "POSITIONS",
  credentialMode: "BYOK_API_KEY",
  status: "PREPARING",
  stage: "PREPARING_SCOPE",
  progress: {
    current: "0",
    total: "2",
    unit: "KEYWORD"
  },
  platformChargeMicro: "0",
  billingCurrency: "RUB",
  createdAt: "2026-07-29T12:00:00.000Z"
} as const;

test("maps every current public manual rank lifecycle family", () => {
  const values = [
    preparing,
    {
      ...preparing,
      status: "QUEUED",
      stage: "WAITING_FOR_QUEUE",
      queuedAt: "2026-07-29T12:00:01.000Z"
    },
    {
      ...preparing,
      status: "RUNNING",
      stage: "WAITING_PROVIDER",
      queuedAt: "2026-07-29T12:00:01.000Z",
      startedAt: "2026-07-29T12:00:02.000Z"
    },
    {
      ...preparing,
      status: "CANCEL_REQUESTED",
      stage: "PREPARING_SCOPE"
    },
    {
      ...preparing,
      status: "CANCEL_REQUESTED",
      stage: "WAITING_FOR_QUEUE",
      queuedAt: "2026-07-29T12:00:01.000Z"
    },
    {
      ...preparing,
      status: "CANCEL_REQUESTED",
      stage: "WAITING_PROVIDER",
      queuedAt: "2026-07-29T12:00:01.000Z",
      startedAt: "2026-07-29T12:00:02.000Z"
    },
    {
      ...preparing,
      status: "CANCELLED",
      stage: "FINISHED",
      finishedAt: "2026-07-29T12:00:03.000Z"
    },
    {
      ...preparing,
      status: "PARTIALLY_COMPLETED",
      stage: "FINISHED",
      progress: { ...preparing.progress, current: "1" },
      result: result({
        persistedCount: "1",
        foundCount: "1",
        failedCount: "1"
      }),
      queuedAt: "2026-07-29T12:00:01.000Z",
      startedAt: "2026-07-29T12:00:02.000Z",
      finishedAt: "2026-07-29T12:00:03.000Z"
    },
    {
      ...preparing,
      status: "COMPLETED",
      stage: "FINISHED",
      progress: { ...preparing.progress, current: "2" },
      result: result({
        persistedCount: "2",
        foundCount: "1",
        notFoundCount: "1"
      }),
      queuedAt: "2026-07-29T12:00:01.000Z",
      startedAt: "2026-07-29T12:00:02.000Z",
      finishedAt: "2026-07-29T12:00:03.000Z"
    },
    {
      ...preparing,
      status: "FAILED",
      stage: "FINISHED",
      failure: { code: "INTERNAL_ERROR" },
      finishedAt: "2026-07-29T12:00:03.000Z"
    },
    actionRequired()
  ];

  for (const value of values) {
    const mapped = scopedRankJobSummary(
      value,
      workspaceId,
      projectId,
      jobId
    );
    assert.equal(mapped.id, jobId);
    assert.equal(mapped.status, value.status);
  }
});

test("rejects private fields and every cross-scope response", () => {
  for (const value of [
    { ...preparing, credentialId: contextId },
    { ...preparing, providerRequestId: "provider-task-1" },
    {
      ...preparing,
      workspaceId: "01900000-0000-7000-8000-000000000099"
    },
    {
      ...preparing,
      projectId: "01900000-0000-7000-8000-000000000099"
    },
    {
      ...preparing,
      id: "01900000-0000-7000-8000-000000000099"
    }
  ]) {
    assert.throws(
      () =>
        scopedRankJobSummary(
          value,
          workspaceId,
          projectId,
          jobId
        ),
      invalidDependencyResponse
    );
  }
});

test("rejects contradictory lifecycle, counts and timestamps", () => {
  for (const value of [
    { ...preparing, queuedAt: "2026-07-29T12:00:01.000Z" },
    { ...preparing, stage: "WAITING_FOR_QUEUE" },
    {
      ...preparing,
      progress: { ...preparing.progress, current: "1" }
    },
    {
      ...preparing,
      status: "QUEUED",
      stage: "WAITING_FOR_QUEUE",
      progress: { ...preparing.progress, current: "1" },
      queuedAt: "2026-07-29T12:00:01.000Z"
    },
    {
      ...preparing,
      status: "CANCEL_REQUESTED",
      stage: "PREPARING_SCOPE",
      queuedAt: "2026-07-29T12:00:01.000Z"
    },
    {
      ...preparing,
      status: "CANCEL_REQUESTED",
      stage: "WAITING_FOR_QUEUE"
    },
    {
      ...preparing,
      status: "CANCEL_REQUESTED",
      stage: "WAITING_FOR_QUEUE",
      queuedAt: "2026-07-29T12:00:01.000Z",
      startedAt: "2026-07-29T12:00:02.000Z"
    },
    {
      ...preparing,
      status: "CANCEL_REQUESTED",
      stage: "WAITING_PROVIDER",
      queuedAt: "2026-07-29T12:00:01.000Z"
    },
    {
      ...preparing,
      status: "CANCEL_REQUESTED",
      stage: "WAITING_PROVIDER",
      startedAt: "2026-07-29T12:00:02.000Z"
    },
    {
      ...preparing,
      progress: { ...preparing.progress, current: "3" }
    },
    {
      ...preparing,
      status: "COMPLETED",
      stage: "FINISHED",
      progress: { ...preparing.progress, current: "2" },
      result: result({
        persistedCount: "2",
        foundCount: "2",
        failedCount: "1"
      }),
      finishedAt: "2026-07-29T12:00:03.000Z"
    },
    {
      ...preparing,
      status: "PARTIALLY_COMPLETED",
      stage: "FINISHED",
      result: result({}),
      finishedAt: "2026-07-29T12:00:03.000Z"
    },
    {
      ...preparing,
      status: "FAILED",
      stage: "FINISHED",
      failure: { code: "SUBMIT_OUTCOME_UNKNOWN" },
      finishedAt: "2026-07-29T12:00:03.000Z"
    },
    {
      ...actionRequired(),
      result: result({ submitOutcomeUnknownCount: "1" })
    },
    {
      ...preparing,
      status: "CANCELLED",
      stage: "FINISHED",
      finishedAt: "2026-07-29T11:59:59.000Z"
    },
    {
      ...preparing,
      createdAt: "2026-07-29T12:00:00Z"
    },
    {
      ...preparing,
      progress: {
        ...preparing.progress,
        current: "9".repeat(100_000)
      }
    }
  ]) {
    assert.throws(
      () =>
        scopedRankJobSummary(
          value,
          workspaceId,
          projectId,
          jobId
        ),
      invalidDependencyResponse
    );
  }
});

test("requires the trusted billing currency on create responses", () => {
  assert.throws(
    () =>
      scopedRankJobSummary(
        preparing,
        workspaceId,
        projectId,
        undefined,
        "USD"
      ),
    invalidDependencyResponse
  );
});

test("accepts rank progress up to 15,000 keywords and rejects overflow", () => {
  assert.equal(
    scopedRankJobSummary(
      {
        ...preparing,
        progress: { current: "0", total: "15000", unit: "KEYWORD" }
      },
      workspaceId,
      projectId,
      jobId
    ).progress.total,
    "15000"
  );
  assert.throws(
    () =>
      scopedRankJobSummary(
        {
          ...preparing,
          progress: { current: "0", total: "15001", unit: "KEYWORD" }
        },
        workspaceId,
        projectId,
        jobId
      ),
    invalidDependencyResponse
  );
});

function actionRequired() {
  return {
    ...preparing,
    status: "ACTION_REQUIRED",
    stage: "SUBMIT_OUTCOME_UNKNOWN",
    result: result({ submitOutcomeUnknownCount: "2" }),
    failure: { code: "SUBMIT_OUTCOME_UNKNOWN" },
    finishedAt: "2026-07-29T12:00:03.000Z"
  } as const;
}

function result(
  overrides: Readonly<
    Partial<{
      pairCount: string;
      persistedCount: string;
      foundCount: string;
      notFoundCount: string;
      failedCount: string;
      submitOutcomeUnknownCount: string;
    }>
  >
) {
  return {
    pairCount: "2",
    persistedCount: "0",
    foundCount: "0",
    notFoundCount: "0",
    failedCount: "0",
    submitOutcomeUnknownCount: "0",
    ...overrides
  };
}

function invalidDependencyResponse(error: unknown): boolean {
  return (
    error instanceof DomainError &&
    error.statusCode === 502 &&
    error.code === "DEPENDENCY_UNAVAILABLE"
  );
}
