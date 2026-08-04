import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { OutboxEvent } from "../generated/prisma/client.js";
import { jobNotificationPayload } from "./job-notification-dispatcher.service.js";

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
