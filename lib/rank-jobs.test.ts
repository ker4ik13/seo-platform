import assert from "node:assert/strict";
import test from "node:test";
import {
  rankJobFailureCodes,
  rankJobStages,
  rankJobStatuses,
  type RankJobSummary
} from "@seo-platform/contracts";
import { BrowserApiError } from "./browser-api.ts";
import {
  RANK_JOB_AUTO_POLL_WINDOW_MS,
  RANK_JOB_GET_TIMEOUT_MS,
  RANK_JOB_MUTATION_TIMEOUT_MS,
  isActiveRankJob,
  isCancellableRankJob,
  isTerminalRankJob,
  parseRankJobSessionHint,
  parseRankJobSummary,
  parseRankPendingCreateReceipt,
  rankJobApiPath,
  rankJobCancelApiPath,
  rankJobCancelFeedback,
  rankJobCreateFeedback,
  rankJobFailureMessage,
  rankJobPollDelayMs,
  rankJobPresentation,
  rankJobProgressPercent,
  rankJobReadFeedback,
  rankJobReconciliationTarget,
  rankJobSessionHintKey,
  rankJobStageLabel,
  rankRunIdempotencyCommand,
  rankRunInput,
  rankRunPayloadSignature,
  rankRunsApiPath,
  rankPendingCreateReceiptKey,
  serializeRankJobSessionHint,
  serializeRankPendingCreateReceipt,
  shouldRetainRankPendingCreateReceipt
} from "./rank-jobs.ts";

const ids = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  trackingContextId: "01900000-0000-7000-8000-000000000003",
  jobId: "01900000-0000-7000-8000-000000000004",
  estimateId: "01900000-0000-7000-8000-000000000005"
} as const;

const expected = {
  workspaceId: ids.workspaceId,
  projectId: ids.projectId,
  trackingContextId: ids.trackingContextId
} as const;

const base = {
  id: ids.jobId,
  workspaceId: ids.workspaceId,
  projectId: ids.projectId,
  trackingContextId: ids.trackingContextId,
  type: "MANUAL_RANK_CHECK",
  provider: "ARSENKIN",
  operation: "POSITIONS",
  credentialMode: "BYOK_API_KEY",
  progress: {
    current: "0",
    total: "4",
    unit: "KEYWORD"
  },
  platformChargeMicro: "0",
  billingCurrency: "RUB",
  createdAt: "2026-07-29T12:00:00.000Z"
} as const;

const completeResult = {
  pairCount: "4",
  persistedCount: "4",
  foundCount: "3",
  notFoundCount: "1",
  failedCount: "0",
  submitOutcomeUnknownCount: "0"
} as const;

test("builds project-safe paths and estimate-only public commands", () => {
  assert.equal(
    rankRunsApiPath("project/one"),
    "/app/api/projects/project%2Fone/rank-runs"
  );
  assert.equal(
    rankJobApiPath("project/one", "job/two"),
    "/app/api/projects/project%2Fone/jobs/job%2Ftwo"
  );
  assert.equal(
    rankJobCancelApiPath("project/one", "job/two"),
    "/app/api/projects/project%2Fone/jobs/job%2Ftwo/cancel"
  );
  assert.deepEqual(rankRunInput(ids.estimateId), {
    estimateId: ids.estimateId
  });
  assert.equal(
    rankRunPayloadSignature(ids.estimateId),
    `{"estimateId":"${ids.estimateId}"}`
  );
});

test("keeps one Idempotency-Key for explicit ambiguous retry only", () => {
  const first = rankRunIdempotencyCommand(
    undefined,
    ids.estimateId,
    () => "rank-run-key-1"
  );
  const ambiguousRetry = rankRunIdempotencyCommand(
    first,
    ids.estimateId,
    () => "rank-run-key-2"
  );
  const nextEstimate = rankRunIdempotencyCommand(
    ambiguousRetry,
    "01900000-0000-7000-8000-000000000006",
    () => "rank-run-key-3"
  );

  assert.equal(ambiguousRetry, first);
  assert.equal(ambiguousRetry.key, "rank-run-key-1");
  assert.equal(nextEstimate.key, "rank-run-key-3");
});

test("parses every valid public lifecycle state through an allowlist", () => {
  const inputs = [
    {
      ...base,
      status: "PREPARING",
      stage: "PREPARING_SCOPE",
      privateCredentialId: "must-not-leak"
    },
    {
      ...base,
      status: "QUEUED",
      stage: "WAITING_FOR_QUEUE",
      queuedAt: "2026-07-29T12:00:01.000Z"
    },
    {
      ...base,
      status: "RUNNING",
      stage: "WAITING_PROVIDER",
      queuedAt: "2026-07-29T12:00:01.000Z",
      startedAt: "2026-07-29T12:00:02.000Z"
    },
    {
      ...base,
      status: "CANCEL_REQUESTED",
      stage: "PREPARING_SCOPE"
    },
    {
      ...base,
      status: "CANCELLED",
      stage: "FINISHED",
      finishedAt: "2026-07-29T12:00:03.000Z"
    },
    {
      ...base,
      progress: { ...base.progress, current: "2" },
      status: "PARTIALLY_COMPLETED",
      stage: "FINISHED",
      queuedAt: "2026-07-29T12:00:01.000Z",
      startedAt: "2026-07-29T12:00:02.000Z",
      finishedAt: "2026-07-29T12:00:03.000Z",
      result: {
        pairCount: "4",
        persistedCount: "2",
        foundCount: "1",
        notFoundCount: "1",
        failedCount: "2",
        submitOutcomeUnknownCount: "0",
        rankingUrl: "private"
      }
    },
    {
      ...base,
      progress: { ...base.progress, current: "4" },
      status: "COMPLETED",
      stage: "FINISHED",
      queuedAt: "2026-07-29T12:00:01.000Z",
      startedAt: "2026-07-29T12:00:02.000Z",
      finishedAt: "2026-07-29T12:00:03.000Z",
      result: completeResult
    },
    {
      ...base,
      progress: { ...base.progress, current: "1" },
      status: "FAILED",
      stage: "FINISHED",
      finishedAt: "2026-07-29T12:00:03.000Z",
      result: {
        pairCount: "4",
        persistedCount: "1",
        foundCount: "1",
        notFoundCount: "0",
        failedCount: "3",
        submitOutcomeUnknownCount: "0"
      },
      failure: {
        code: "PROVIDER_RESPONSE_INVALID",
        rawProviderBody: "private"
      }
    },
    {
      ...base,
      status: "ACTION_REQUIRED",
      stage: "SUBMIT_OUTCOME_UNKNOWN",
      finishedAt: "2026-07-29T12:00:03.000Z",
      result: {
        pairCount: "4",
        persistedCount: "0",
        foundCount: "0",
        notFoundCount: "0",
        failedCount: "0",
        submitOutcomeUnknownCount: "4"
      },
      failure: { code: "SUBMIT_OUTCOME_UNKNOWN" }
    }
  ] as const;

  assert.deepEqual(
    inputs.map((input) => parseRankJobSummary(input, expected).status),
    rankJobStatuses
  );
  const preparing = parseRankJobSummary(inputs[0], expected);
  assert.equal("privateCredentialId" in preparing, false);
  const partial = parseRankJobSummary(inputs[5], expected);
  assert.equal(
    partial.status === "PARTIALLY_COMPLETED" &&
      "rankingUrl" in partial.result,
    false
  );
  const failed = parseRankJobSummary(inputs[7], expected);
  assert.equal(
    failed.status === "FAILED" && "rawProviderBody" in failed.failure,
    false
  );
});

test("accepts every RUNNING stage and rejects all non-running stages", () => {
  const runningStages = [
    "WAITING_EXECUTION_GRANT",
    "READY_TO_SUBMIT",
    "SUBMITTING",
    "WAITING_PROVIDER",
    "FETCHING_RESULT",
    "PERSISTING_RESULT",
    "FINALIZING"
  ] as const;
  for (const stage of runningStages) {
    assert.equal(
      parseRankJobSummary(
        {
          ...base,
          status: "RUNNING",
          stage,
          queuedAt: "2026-07-29T12:00:01.000Z",
          startedAt: "2026-07-29T12:00:02.000Z"
        },
        expected
      ).stage,
      stage
    );
  }
  for (const stage of rankJobStages.filter(
    (value) => !runningStages.includes(value as (typeof runningStages)[number])
  )) {
    assert.throws(() =>
      parseRankJobSummary(
        {
          ...base,
          status: "RUNNING",
          stage,
          queuedAt: "2026-07-29T12:00:01.000Z",
          startedAt: "2026-07-29T12:00:02.000Z"
        },
        expected
      )
    );
  }
});

test("accepts cancellation only with stage-matching execution times", () => {
  const inputs = [
    {
      ...base,
      status: "CANCEL_REQUESTED",
      stage: "PREPARING_SCOPE"
    },
    {
      ...base,
      status: "CANCEL_REQUESTED",
      stage: "WAITING_FOR_QUEUE",
      queuedAt: "2026-07-29T12:00:01.000Z"
    },
    {
      ...base,
      progress: { ...base.progress, current: "2" },
      status: "CANCEL_REQUESTED",
      stage: "PERSISTING_RESULT",
      queuedAt: "2026-07-29T12:00:01.000Z",
      startedAt: "2026-07-29T12:00:02.000Z"
    }
  ] as const;

  assert.deepEqual(
    inputs.map(
      (input) => parseRankJobSummary(input, expected).stage
    ),
    ["PREPARING_SCOPE", "WAITING_FOR_QUEUE", "PERSISTING_RESULT"]
  );
});

test("rejects cross-scope identities and malformed identifiers", () => {
  for (const mutation of [
    { workspaceId: "01900000-0000-7000-8000-000000000099" },
    { projectId: "01900000-0000-7000-8000-000000000099" },
    { trackingContextId: "01900000-0000-7000-8000-000000000099" },
    { id: "not-a-job-id" }
  ]) {
    assert.throws(
      () =>
        parseRankJobSummary(
          {
            ...base,
            status: "PREPARING",
            stage: "PREPARING_SCOPE",
            ...mutation
          },
          expected
        ),
      (error: unknown) =>
        error instanceof BrowserApiError &&
        error.code === "INVALID_RESPONSE"
    );
  }
  assert.throws(() =>
    parseRankJobSummary(
      { ...base, status: "PREPARING", stage: "PREPARING_SCOPE" },
      {
        ...expected,
        jobId: "01900000-0000-7000-8000-000000000099"
      }
    )
  );
});

test("rejects contradictory lifecycle fields and non-monotonic dates", () => {
  const invalid = [
    {
      ...base,
      status: "PREPARING",
      stage: "PREPARING_SCOPE",
      result: completeResult
    },
    {
      ...base,
      status: "QUEUED",
      stage: "WAITING_FOR_QUEUE"
    },
    {
      ...base,
      status: "RUNNING",
      stage: "WAITING_PROVIDER",
      queuedAt: "2026-07-29T12:00:02.000Z",
      startedAt: "2026-07-29T12:00:01.000Z"
    },
    {
      ...base,
      status: "CANCEL_REQUESTED",
      stage: "SUBMIT_OUTCOME_UNKNOWN"
    },
    {
      ...base,
      status: "CANCEL_REQUESTED",
      stage: "WAITING_FOR_QUEUE"
    },
    {
      ...base,
      status: "CANCEL_REQUESTED",
      stage: "WAITING_PROVIDER",
      queuedAt: "2026-07-29T12:00:01.000Z"
    },
    {
      ...base,
      status: "CANCEL_REQUESTED",
      stage: "PREPARING_SCOPE",
      queuedAt: "2026-07-29T12:00:01.000Z"
    },
    {
      ...base,
      status: "COMPLETED",
      stage: "FINISHED",
      finishedAt: "2026-07-29T11:59:59.000Z",
      result: completeResult
    },
    {
      ...base,
      createdAt: "2026-07-29 12:00:00Z",
      status: "PREPARING",
      stage: "PREPARING_SCOPE"
    },
    {
      ...base,
      createdAt: "2026-02-30T12:00:00.000Z",
      status: "PREPARING",
      stage: "PREPARING_SCOPE"
    },
    {
      ...base,
      status: "FAILED",
      stage: "FINISHED",
      finishedAt: "2026-07-29T12:00:03.000Z",
      failure: { code: "SUBMIT_OUTCOME_UNKNOWN" }
    },
    {
      ...base,
      status: "ACTION_REQUIRED",
      stage: "FINISHED",
      finishedAt: "2026-07-29T12:00:03.000Z",
      result: completeResult,
      failure: { code: "SUBMIT_OUTCOME_UNKNOWN" }
    }
  ] as const;
  for (const input of invalid) {
    assert.throws(() => parseRankJobSummary(input, expected));
  }
});

test("enforces progress and terminal count invariants", () => {
  const invalid = [
    {
      ...base,
      progress: { current: "5", total: "4", unit: "KEYWORD" },
      status: "PREPARING",
      stage: "PREPARING_SCOPE"
    },
    {
      ...base,
      progress: { current: "1", total: "4", unit: "KEYWORD" },
      status: "PREPARING",
      stage: "PREPARING_SCOPE"
    },
    {
      ...base,
      progress: { current: "1", total: "4", unit: "KEYWORD" },
      status: "QUEUED",
      stage: "WAITING_FOR_QUEUE",
      queuedAt: "2026-07-29T12:00:01.000Z"
    },
    {
      ...base,
      progress: { current: "4", total: "4", unit: "ROW" },
      status: "COMPLETED",
      stage: "FINISHED",
      finishedAt: "2026-07-29T12:00:03.000Z",
      result: completeResult
    },
    {
      ...base,
      progress: { ...base.progress, current: "4" },
      status: "COMPLETED",
      stage: "FINISHED",
      finishedAt: "2026-07-29T12:00:03.000Z",
      result: { ...completeResult, foundCount: "4", notFoundCount: "1" }
    },
    {
      ...base,
      progress: { ...base.progress, current: "3" },
      status: "COMPLETED",
      stage: "FINISHED",
      finishedAt: "2026-07-29T12:00:03.000Z",
      result: { ...completeResult, persistedCount: "3" }
    },
    {
      ...base,
      progress: { ...base.progress, current: "2" },
      status: "PARTIALLY_COMPLETED",
      stage: "FINISHED",
      finishedAt: "2026-07-29T12:00:03.000Z",
      result: {
        pairCount: "4",
        persistedCount: "2",
        foundCount: "2",
        notFoundCount: "0",
        failedCount: "1",
        submitOutcomeUnknownCount: "0"
      }
    },
    {
      ...base,
      status: "ACTION_REQUIRED",
      stage: "SUBMIT_OUTCOME_UNKNOWN",
      finishedAt: "2026-07-29T12:00:03.000Z",
      result: {
        pairCount: "4",
        persistedCount: "0",
        foundCount: "0",
        notFoundCount: "0",
        failedCount: "1",
        submitOutcomeUnknownCount: "3"
      },
      failure: { code: "SUBMIT_OUTCOME_UNKNOWN" }
    }
  ] as const;
  for (const input of invalid) {
    assert.throws(() => parseRankJobSummary(input, expected));
  }
});

test("classifies active, cancellable and terminal states", () => {
  const preparing = parseRankJobSummary(
    { ...base, status: "PREPARING", stage: "PREPARING_SCOPE" },
    expected
  );
  const cancelling = parseRankJobSummary(
    {
      ...base,
      status: "CANCEL_REQUESTED",
      stage: "PREPARING_SCOPE"
    },
    expected
  );
  const cancelled = parseRankJobSummary(
    {
      ...base,
      status: "CANCELLED",
      stage: "FINISHED",
      finishedAt: "2026-07-29T12:00:03.000Z"
    },
    expected
  );

  assert.equal(isActiveRankJob(preparing), true);
  assert.equal(isCancellableRankJob(preparing), true);
  assert.equal(isActiveRankJob(cancelling), true);
  assert.equal(isCancellableRankJob(cancelling), false);
  assert.equal(isTerminalRankJob(cancelled), true);
});

test("uses bounded status-aware polling and exact progress", () => {
  const preparing = parseRankJobSummary(
    { ...base, status: "PREPARING", stage: "PREPARING_SCOPE" },
    expected
  );
  const queued = parseRankJobSummary(
    {
      ...base,
      status: "QUEUED",
      stage: "WAITING_FOR_QUEUE",
      queuedAt: "2026-07-29T12:00:01.000Z"
    },
    expected
  );
  const completed = parseRankJobSummary(
    {
      ...base,
      progress: { ...base.progress, current: "4" },
      status: "COMPLETED",
      stage: "FINISHED",
      finishedAt: "2026-07-29T12:00:03.000Z",
      result: completeResult
    },
    expected
  );

  assert.equal(rankJobPollDelayMs(preparing, 0), 1_500);
  assert.equal(rankJobPollDelayMs(preparing, 15_000), 2_500);
  assert.equal(rankJobPollDelayMs(queued, 0), 2_500);
  assert.equal(rankJobPollDelayMs(queued, 30_000), 5_000);
  assert.equal(rankJobPollDelayMs(completed, 0), undefined);
  assert.equal(rankJobProgressPercent(preparing), 0);
  assert.equal(rankJobProgressPercent(completed), 100);
  assert.equal(RANK_JOB_AUTO_POLL_WINDOW_MS, 300_000);
  assert.equal(RANK_JOB_GET_TIMEOUT_MS, 10_000);
  assert.equal(RANK_JOB_MUTATION_TIMEOUT_MS, 15_000);
  assert.equal(
    rankJobReconciliationTarget(preparing, undefined),
    ids.jobId
  );
  assert.equal(
    rankJobReconciliationTarget(completed, ids.jobId),
    undefined
  );
  assert.equal(
    rankJobReconciliationTarget(undefined, ids.jobId),
    ids.jobId
  );
});

test("provides finite labels for every stage, failure and status", () => {
  for (const stage of rankJobStages) {
    assert.ok(rankJobStageLabel(stage).length > 5, stage);
  }
  for (const code of rankJobFailureCodes) {
    assert.ok(rankJobFailureMessage(code).length > 20, code);
  }

  const lifecycle: readonly RankJobSummary[] = [
    parseRankJobSummary(
      { ...base, status: "PREPARING", stage: "PREPARING_SCOPE" },
      expected
    ),
    parseRankJobSummary(
      {
        ...base,
        status: "QUEUED",
        stage: "WAITING_FOR_QUEUE",
        queuedAt: "2026-07-29T12:00:01.000Z"
      },
      expected
    ),
    parseRankJobSummary(
      {
        ...base,
        status: "RUNNING",
        stage: "WAITING_PROVIDER",
        queuedAt: "2026-07-29T12:00:01.000Z",
        startedAt: "2026-07-29T12:00:02.000Z"
      },
      expected
    ),
    parseRankJobSummary(
      {
        ...base,
        status: "CANCEL_REQUESTED",
        stage: "PREPARING_SCOPE"
      },
      expected
    ),
    parseRankJobSummary(
      {
        ...base,
        status: "CANCELLED",
        stage: "FINISHED",
        finishedAt: "2026-07-29T12:00:03.000Z"
      },
      expected
    ),
    parseRankJobSummary(
      {
        ...base,
        progress: { ...base.progress, current: "2" },
        status: "PARTIALLY_COMPLETED",
        stage: "FINISHED",
        finishedAt: "2026-07-29T12:00:03.000Z",
        result: {
          pairCount: "4",
          persistedCount: "2",
          foundCount: "2",
          notFoundCount: "0",
          failedCount: "2",
          submitOutcomeUnknownCount: "0"
        }
      },
      expected
    ),
    parseRankJobSummary(
      {
        ...base,
        progress: { ...base.progress, current: "4" },
        status: "COMPLETED",
        stage: "FINISHED",
        finishedAt: "2026-07-29T12:00:03.000Z",
        result: completeResult
      },
      expected
    ),
    parseRankJobSummary(
      {
        ...base,
        status: "FAILED",
        stage: "FINISHED",
        finishedAt: "2026-07-29T12:00:03.000Z",
        failure: { code: "INTERNAL_ERROR" }
      },
      expected
    ),
    parseRankJobSummary(
      {
        ...base,
        status: "ACTION_REQUIRED",
        stage: "SUBMIT_OUTCOME_UNKNOWN",
        finishedAt: "2026-07-29T12:00:03.000Z",
        result: {
          pairCount: "4",
          persistedCount: "0",
          foundCount: "0",
          notFoundCount: "0",
          failedCount: "0",
          submitOutcomeUnknownCount: "4"
        },
        failure: { code: "SUBMIT_OUTCOME_UNKNOWN" }
      },
      expected
    )
  ];
  assert.deepEqual(
    lifecycle.map((job) => job.status),
    rankJobStatuses
  );
  for (const job of lifecycle) {
    const presentation = rankJobPresentation(job);
    assert.ok(presentation.title.length > 5, job.status);
    assert.ok(presentation.message.length > 20, job.status);
  }
  assert.match(
    rankJobPresentation(lifecycle.at(-1) as RankJobSummary).message,
    /Автоповтор/u
  );
});

test("maps create failures to same-command retry or explicit recalculation", () => {
  assert.equal(
    rankJobCreateFeedback(new TypeError("offline"), false).action,
    "RETRY_SAME_COMMAND"
  );
  assert.equal(
    rankJobCreateFeedback(
      new BrowserApiError(502, "INVALID_RESPONSE", "invalid"),
      true
    ).action,
    "RETRY_SAME_COMMAND"
  );
  for (const reason of [
    "ESTIMATE_EXPIRED",
    "ESTIMATE_STALE",
    "EXECUTION_GRANT_DENIED"
  ] as const) {
    assert.equal(
      rankJobCreateFeedback(
        new BrowserApiError(
          409,
          "RESOURCE_STATE_CONFLICT",
          "conflict",
          [],
          undefined,
          false,
          { reason }
        ),
        true
      ).action,
      "RECALCULATE"
    );
  }
  assert.equal(
    rankJobCreateFeedback(
      new BrowserApiError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "conflict"
      ),
      true
    ).action,
    "RECALCULATE"
  );
  const attachableFeedback = rankJobCreateFeedback(
    new BrowserApiError(
      409,
      "RESOURCE_STATE_CONFLICT",
      "active",
      [],
      undefined,
      false,
      {
        reason: "EQUIVALENT_RUN_ACTIVE",
        existingJobId: ids.jobId
      }
    ),
    true
  );
  assert.equal(attachableFeedback.action, "ATTACH_EXISTING");
  assert.equal(attachableFeedback.attachJobId, ids.jobId);
  assert.equal(
    rankJobCreateFeedback(
      new BrowserApiError(
        409,
        "EQUIVALENT_RUN_ACTIVE",
        "active"
      ),
      true
    ).action,
    "RETRY_SAME_COMMAND"
  );
  assert.equal(
    rankJobCreateFeedback(
      new BrowserApiError(503, "DEPENDENCY_UNAVAILABLE", "down", [], "req-1"),
      true
    ).requestId,
    "req-1"
  );
  assert.doesNotMatch(
    rankJobCreateFeedback(
      new BrowserApiError(400, "UNKNOWN", "private upstream detail"),
      true
    ).message,
    /private upstream detail/u
  );

  const equivalent = new BrowserApiError(
    409,
    "RESOURCE_STATE_CONFLICT",
    "active",
    [],
    undefined,
    false,
    {
      reason: "EQUIVALENT_RUN_ACTIVE",
      existingJobId: ids.jobId
    }
  );
  const expired = new BrowserApiError(
    409,
    "RESOURCE_STATE_CONFLICT",
    "expired",
    [],
    undefined,
    false,
    { reason: "ESTIMATE_EXPIRED" }
  );
  for (const ambiguous of [
    new TypeError("offline"),
    new Error("unknown"),
    new BrowserApiError(502, "INVALID_RESPONSE", "invalid"),
    new BrowserApiError(503, "DEPENDENCY_UNAVAILABLE", "down"),
    new BrowserApiError(429, "RATE_LIMITED", "later"),
    new BrowserApiError(401, "UNAUTHORIZED", "refresh"),
    equivalent
  ]) {
    assert.equal(
      shouldRetainRankPendingCreateReceipt(ambiguous, true),
      true
    );
  }
  assert.equal(
    shouldRetainRankPendingCreateReceipt(
      new TypeError("offline"),
      false
    ),
    true
  );
  for (const rejected of [
    expired,
    new BrowserApiError(403, "FORBIDDEN", "forbidden"),
    new BrowserApiError(400, "VALIDATION_FAILED", "invalid")
  ]) {
    assert.equal(
      shouldRetainRankPendingCreateReceipt(rejected, true),
      false
    );
  }
});

test("retains stale read state and distinguishes cancel permission", () => {
  assert.equal(
    rankJobReadFeedback(new TypeError("offline"), false).action,
    "REFRESH"
  );
  assert.equal(
    rankJobReadFeedback(
      new BrowserApiError(403, "FORBIDDEN", "forbidden"),
      true
    ).action,
    "NONE"
  );
  assert.equal(
    rankJobCancelFeedback(new TypeError("offline"), false).action,
    "RETRY_CANCEL"
  );
  const forbidden = rankJobCancelFeedback(
    new BrowserApiError(403, "FORBIDDEN", "forbidden"),
    true
  );
  assert.equal(forbidden.action, "NONE");
  assert.match(forbidden.message, /collector\.cancel/u);
  assert.doesNotMatch(
    rankJobReadFeedback(
      new BrowserApiError(400, "UNKNOWN", "private upstream detail"),
      true
    ).message,
    /private upstream detail/u
  );
  assert.doesNotMatch(
    rankJobCancelFeedback(
      new BrowserApiError(400, "UNKNOWN", "private upstream detail"),
      true
    ).message,
    /private upstream detail/u
  );
});

test("round-trips only an exact scope-bound sessionStorage hint", () => {
  const hint = {
    version: 1,
    projectId: ids.projectId,
    trackingContextId: ids.trackingContextId,
    jobId: ids.jobId
  } as const;
  const serialized = serializeRankJobSessionHint(hint);
  assert.deepEqual(
    parseRankJobSessionHint(serialized, {
      projectId: ids.projectId,
      trackingContextId: ids.trackingContextId
    }),
    hint
  );
  assert.equal(
    rankJobSessionHintKey(ids.projectId, ids.trackingContextId),
    `rank-job:v1:${ids.projectId}:${ids.trackingContextId}`
  );

  for (const invalid of [
    "",
    "not-json",
    JSON.stringify({ ...hint, version: 2 }),
    JSON.stringify({ ...hint, extra: "private" }),
    JSON.stringify({ ...hint, jobId: "not-a-uuid" }),
    JSON.stringify({
      ...hint,
      projectId: "01900000-0000-7000-8000-000000000099"
    }),
    "x".repeat(513)
  ]) {
    assert.equal(
      parseRankJobSessionHint(invalid, {
        projectId: ids.projectId,
        trackingContextId: ids.trackingContextId
      }),
      undefined
    );
  }
});

test("round-trips only an exact scope-bound pending create receipt", () => {
  const receipt = {
    version: 1,
    projectId: ids.projectId,
    trackingContextId: ids.trackingContextId,
    estimateId: ids.estimateId,
    idempotencyKey:
      "rank-run:01900000-0000-7000-8000-000000000006"
  } as const;
  const serialized = serializeRankPendingCreateReceipt(receipt);
  assert.deepEqual(
    parseRankPendingCreateReceipt(serialized, {
      projectId: ids.projectId,
      trackingContextId: ids.trackingContextId
    }),
    receipt
  );
  assert.equal(
    rankPendingCreateReceiptKey(
      ids.projectId,
      ids.trackingContextId
    ),
    `rank-create:v1:${ids.projectId}:${ids.trackingContextId}`
  );

  for (const invalid of [
    "",
    "not-json",
    JSON.stringify({ ...receipt, version: 2 }),
    JSON.stringify({ ...receipt, extra: "private" }),
    JSON.stringify({ ...receipt, estimateId: "not-a-uuid" }),
    JSON.stringify({ ...receipt, idempotencyKey: "rank-run:unsafe" }),
    JSON.stringify({
      ...receipt,
      trackingContextId:
        "01900000-0000-7000-8000-000000000099"
    }),
    "x".repeat(513)
  ]) {
    assert.equal(
      parseRankPendingCreateReceipt(invalid, {
        projectId: ids.projectId,
        trackingContextId: ids.trackingContextId
      }),
      undefined
    );
  }
});
