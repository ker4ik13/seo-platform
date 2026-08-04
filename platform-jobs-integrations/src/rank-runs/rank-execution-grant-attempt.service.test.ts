import assert from "node:assert/strict";
import test from "node:test";
import type {
  InternalIssueRankExecutionGrantInputV1,
  InternalRankExecutionGrantDecisionV1
} from "@seo-platform/contracts";
import type { AppConfig } from "../config/app-config.js";
import type {
  RankExecutionGrantAttempt,
  RankExecutionGrantAttemptStatus
} from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import {
  RankExecutionGrantClientError,
  type RankExecutionGrantClient
} from "../platform-api/rank-execution-grant.client.js";
import {
  RankExecutionGrantAttemptError,
  RankExecutionGrantAttemptService,
  type RankExecutionGrantAttemptResult
} from "./rank-execution-grant-attempt.service.js";
import {
  RankProviderRequestIntentError,
  type RankProviderRequestIntentService
} from "./rank-provider-request-intent.service.js";

const jobItemId = "01900000-0000-7000-8000-000000000004";

test("does not prepare an intent outside the enabled rank worker", async () => {
  const fixture = service(false);
  await assert.rejects(
    fixture.service.issueForItem(jobItemId, "request-1"),
    (error: unknown) =>
      error instanceof RankExecutionGrantAttemptError &&
      error.code === "SUBMIT_DISABLED" &&
      !error.retryable
  );
  assert.deepEqual(fixture.events, []);
});

test("rejects malformed request context before durable preparation", async () => {
  const fixture = service(true);
  await assert.rejects(
    fixture.service.issueForItem(jobItemId, "invalid request id"),
    (error: unknown) =>
      error instanceof RankExecutionGrantAttemptError &&
      error.code === "INVALID_REQUEST" &&
      !error.retryable
  );
  assert.deepEqual(fixture.events, []);
});

test("does not prepare or issue after terminal local intent drift", async () => {
  const fixture = service(
    true,
    undefined,
    "REQUESTED",
    deniedDecision(),
    new RankProviderRequestIntentError(
      "LOCAL_STATE_INVALID",
      false
    )
  );
  await assert.rejects(
    fixture.service.issueForItem(jobItemId, "request-1"),
    (error: unknown) =>
      error instanceof RankExecutionGrantAttemptError &&
      error.code === "LOCAL_STATE_INVALID" &&
      !error.retryable
  );
  assert.deepEqual(fixture.events, ["intent"]);
});

test("keeps manifest dependency failure retryable before issuer", async () => {
  const fixture = service(
    true,
    undefined,
    "REQUESTED",
    deniedDecision(),
    new RankProviderRequestIntentError(
      "DEPENDENCY_UNAVAILABLE",
      true
    )
  );
  await assert.rejects(
    fixture.service.issueForItem(jobItemId, "request-1"),
    (error: unknown) =>
      error instanceof RankExecutionGrantAttemptError &&
      error.code === "DEPENDENCY_UNAVAILABLE" &&
      error.retryable
  );
  assert.deepEqual(fixture.events, ["intent"]);
});

test("commits preparation before calling the issuer and then settles", async () => {
  const fixture = service(true);
  const result = await fixture.service.issueForItem(
    jobItemId,
    "request-1"
  );

  assert.deepEqual(fixture.events, [
    "intent",
    "prepare",
    "issue",
    "record"
  ]);
  assert.equal(result.status, "DENIED");
});

test("keeps REQUESTED untouched after retryable transport ambiguity", async () => {
  const fixture = service(
    true,
    new RankExecutionGrantClientError("UNAVAILABLE", true)
  );
  await assert.rejects(
    fixture.service.issueForItem(jobItemId, "request-1"),
    (error: unknown) =>
      error instanceof RankExecutionGrantAttemptError &&
      error.code === "DEPENDENCY_UNAVAILABLE" &&
      error.retryable
  );
  assert.deepEqual(fixture.events, ["intent", "prepare", "issue"]);
});

test("terminally rejects a non-retryable issuer response", async () => {
  const fixture = service(
    true,
    new RankExecutionGrantClientError("INVALID_RESPONSE", false)
  );
  await assert.rejects(
    fixture.service.issueForItem(jobItemId, "request-1"),
    (error: unknown) =>
      error instanceof RankExecutionGrantAttemptError &&
      error.code === "DECISION_REJECTED" &&
      !error.retryable
  );
  assert.deepEqual(fixture.events, [
    "intent",
    "prepare",
    "issue",
    "reject"
  ]);
});

test("does not call the issuer for an already settled attempt", async () => {
  const fixture = service(true, undefined, "DENIED");
  const result = await fixture.service.issueForItem(
    jobItemId,
    "request-1"
  );
  assert.equal(result.status, "DENIED");
  assert.deepEqual(fixture.events, ["intent", "prepare"]);
});

test("atomically consumes a granted decision into scoped execution state", async () => {
  const fixture = service(
    true,
    undefined,
    "REQUESTED",
    grantedDecision()
  );
  const result = await fixture.service.issueForItem(
    jobItemId,
    "request-1"
  );

  assert.equal(result.status, "CONSUMED");
  assert.deepEqual(fixture.events, [
    "intent",
    "prepare",
    "issue",
    "record",
    "consume"
  ]);
});

test("resumes a pending consume without another issuer request", async () => {
  const fixture = service(
    true,
    undefined,
    "GRANTED_PENDING_CONSUME"
  );
  const result = await fixture.service.issueForItem(
    jobItemId,
    "request-1"
  );

  assert.equal(result.status, "CONSUMED");
  assert.deepEqual(fixture.events, ["intent", "prepare", "consume"]);
});

function service(
  submitEnabled: boolean,
  clientError?: Error,
  status: RankExecutionGrantAttemptStatus = "REQUESTED",
  clientDecision: InternalRankExecutionGrantDecisionV1 = deniedDecision(),
  intentError?: RankProviderRequestIntentError
): {
  readonly service: RankExecutionGrantAttemptService;
  readonly events: string[];
} {
  const events: string[] = [];
  const client = {
    issue: async () => {
      events.push("issue");
      if (clientError) throw clientError;
      return clientDecision;
    }
  } as unknown as RankExecutionGrantClient;
  const requestIntents = {
    ensureForItem: async () => {
      events.push("intent");
      if (intentError) throw intentError;
      return {};
    }
  } as unknown as RankProviderRequestIntentService;
  const instance = new RankExecutionGrantAttemptService(
    {} as PrismaService,
    client,
    requestIntents,
    {
      rankGrantApiToken: submitEnabled ? "grant-token" : undefined,
      rankPreparation: { enabled: submitEnabled },
      rankExecution: {
        submitEnabled,
        killSwitchVersion: "arsenkin-positions@1"
      }
    } as AppConfig
  );
  const internals = instance as unknown as {
    prepare: (jobItemId: string) => Promise<{
      readonly attempt: RankExecutionGrantAttempt;
      readonly request: InternalIssueRankExecutionGrantInputV1;
    }>;
    recordDecision: (
      attempt: RankExecutionGrantAttempt,
      decision: InternalRankExecutionGrantDecisionV1
    ) => Promise<RankExecutionGrantAttemptResult>;
    rejectPending: (attempt: RankExecutionGrantAttempt) => Promise<void>;
    consumePending: (
      attempt: RankExecutionGrantAttempt
    ) => Promise<RankExecutionGrantAttemptResult>;
  };
  internals.prepare = async () => {
    events.push("prepare");
    return {
      attempt: storedAttempt(status),
      request: {} as InternalIssueRankExecutionGrantInputV1
    };
  };
  internals.recordDecision = async (attempt, decision) => {
    events.push("record");
    return result(
      attempt,
      decision.status === "GRANTED"
        ? "GRANTED_PENDING_CONSUME"
        : "DENIED",
      decision
    );
  };
  internals.rejectPending = async () => {
    events.push("reject");
  };
  internals.consumePending = async (attempt) => {
    events.push("consume");
    return result(attempt, "CONSUMED", clientDecision);
  };
  return { service: instance, events };
}

function storedAttempt(
  status: RankExecutionGrantAttemptStatus
): RankExecutionGrantAttempt {
  const now = new Date("2026-07-29T12:00:00.000Z");
  return {
    id: "01900000-0000-7000-8000-000000000005",
    workspaceId: "01900000-0000-7000-8000-000000000001",
    projectId: "01900000-0000-7000-8000-000000000002",
    jobId: "01900000-0000-7000-8000-000000000003",
    jobItemId,
    executionAttempt: 1,
    jobVersion: 2,
    idempotencyKey: `rank-grant:${jobItemId}:1`,
    requestSnapshot: {},
    requestHash: Uint8Array.from(Buffer.alloc(32)),
    scopeHash: Uint8Array.from(Buffer.alloc(32)),
    executionEvidenceHash: Uint8Array.from(Buffer.alloc(32)),
    decisionSnapshot: null,
    status,
    decidedAt: null,
    expiresAt: null,
    terminalAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function result(
  attempt: RankExecutionGrantAttempt,
  status: RankExecutionGrantAttemptStatus,
  decision?: InternalRankExecutionGrantDecisionV1
): RankExecutionGrantAttemptResult {
  return {
    id: attempt.id,
    workspaceId: attempt.workspaceId,
    projectId: attempt.projectId,
    jobId: attempt.jobId,
    jobItemId: attempt.jobItemId,
    executionAttempt: attempt.executionAttempt,
    status,
    ...(decision ? { decision } : {})
  };
}

function deniedDecision(): InternalRankExecutionGrantDecisionV1 {
  return {
    schemaVersion: "rank-execution-grant-decision@1",
    status: "DENIED",
    requestHash: {
      algorithm: "SHA_256",
      value: "a".repeat(64)
    },
    decidedAt: "2026-07-29T12:00:00.000Z",
    reason: "ENTITLEMENT_DENIED"
  };
}

function grantedDecision(): InternalRankExecutionGrantDecisionV1 {
  return {
    schemaVersion: "rank-execution-grant-decision@1",
    status: "GRANTED",
    requestHash: {
      algorithm: "SHA_256",
      value: "a".repeat(64)
    },
    decidedAt: "2026-07-29T12:00:00.000Z",
    grant: {
      schemaVersion: "rank-execution-grant@1",
      id: "01900000-0000-7000-8000-000000000006",
      requestHash: {
        algorithm: "SHA_256",
        value: "a".repeat(64)
      },
      scopeHash: {
        algorithm: "SHA_256",
        value: "b".repeat(64)
      },
      issuer: "PLATFORM_API",
      issuedAt: "2026-07-29T12:00:00.000Z",
      expiresAt: "2026-07-29T12:00:30.000Z"
    }
  };
}
