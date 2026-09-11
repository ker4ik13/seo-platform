import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { OutboxEvent } from "../generated/prisma/client.js";
import {
  jobNotificationOperationType,
  jobNotificationPayload
} from "./job-notification-dispatcher.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";

test("validates terminal job notification outbox payload", () => {
  const payload = jobNotificationPayload(event());
  assert.equal(payload.jobId, jobId);
  assert.equal(payload.status, "COMPLETED");
  assert.throws(() =>
    jobNotificationPayload({
      ...event(),
      eventType: "job.notification.failed.requested.v1"
    })
  );
});

test("derives a distinct notification operation from immutable job scope", () => {
  const operation = (
    type: string,
    inputSnapshot: Record<string, string> = {},
    scopeSnapshot: Record<string, string> = {}
  ) => jobNotificationOperationType({ type, inputSnapshot, scopeSnapshot });

  assert.equal(operation("MANUAL_RANK_CHECK"), "RANK_POSITION_TRACKING");
  assert.equal(
    operation("MANUAL_RANK_CHECK", {}, { purpose: "COMPETITOR_SERP" }),
    "RANK_COMPETITOR_SERP"
  );
  assert.equal(operation("AI_ANSWER_COLLECTION"), "AI_ANSWER_COLLECTION");
  assert.equal(
    operation("AI_ANSWER_COLLECTION", { purpose: "COMPETITOR_SERP" }),
    "AI_COMPETITOR_SERP"
  );
  assert.equal(
    operation("FREQUENCY_COLLECTION", { mode: "FREQUENCY" }),
    "WORDSTAT_FREQUENCY_COLLECTION"
  );
  assert.equal(
    operation("FREQUENCY_COLLECTION", { mode: "SEASONALITY" }),
    "WORDSTAT_SEASONALITY_COLLECTION"
  );
  assert.equal(
    operation("KEYWORD_RESEARCH", { source: "KEYS_SO" }),
    "KEYS_SO_RESEARCH"
  );
  assert.equal(
    operation("KEYWORD_RESEARCH", { source: "ARSENKIN_WORDSTAT" }),
    "WORDSTAT_KEYWORD_RESEARCH"
  );
  assert.equal(operation("CLUSTERING_RUN"), "CLUSTERING_RUN");
});

test("migration prevents duplicate terminal notifications across replicas", () => {
  const migration = readFileSync(
    new URL(
      "../../prisma/migrations/20260802170000_terminal_job_notifications/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(migration, /CREATE UNIQUE INDEX/u);
  assert.match(migration, /"event_type", "aggregate_id"/u);
  assert.match(migration, /job\.notification\.completed\.requested\.v1/u);
});

test("route fix migration replays only failed terminal notifications", () => {
  const migration = readFileSync(
    new URL(
      "../../prisma/migrations/20260805163000_retry_terminal_job_notifications/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(migration, /"status" = 'FAILED'/u);
  assert.match(migration, /SET\s+"status" = 'PENDING'/u);
  assert.match(migration, /"attempts" = 0/u);
  assert.match(migration, /job\.notification\.action-required\.requested\.v1/u);
  assert.doesNotMatch(migration, /technical[_.-]crawl/iu);
});

test("contract fix replays only the same idempotent terminal notifications", () => {
  const migration = readFileSync(
    new URL(
      "../../prisma/migrations/20260805171000_retry_terminal_notifications_after_contract_fix/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(migration, /"status" = 'FAILED'/u);
  assert.match(migration, /SET\s+"status" = 'PENDING'/u);
  assert.match(migration, /"attempts" = 0/u);
  assert.match(migration, /job\.notification\.completed\.requested\.v1/u);
  assert.doesNotMatch(migration, /technical[_.-]crawl/iu);
});

function event(): Pick<
  OutboxEvent,
  "aggregateId" | "eventType" | "workspaceId" | "projectId" | "payload"
> {
  return {
    aggregateId: jobId,
    eventType: "job.notification.completed.requested.v1",
    workspaceId,
    projectId,
    payload: {
      workspaceId,
      projectId,
      actorId,
      jobId,
      jobType: "FREQUENCY_COLLECTION",
      status: "COMPLETED",
      progressCurrent: 3,
      progressTotal: 3,
      errorCode: null,
      idempotencyKey: `job-notification:${jobId}:COMPLETED`
    }
  };
}
