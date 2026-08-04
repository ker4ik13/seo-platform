import assert from "node:assert/strict";
import test from "node:test";
import { jobNotificationContent } from "./job-notification.controller.js";
import { jobNotificationInput } from "./job-notification.input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";

test("accepts a tenant-bound terminal job notification", () => {
  assert.deepEqual(jobNotificationInput(validInput()), validInput());
});

test("rejects mismatched idempotency and invalid progress", () => {
  assert.throws(() =>
    jobNotificationInput({
      ...validInput(),
      progressCurrent: 4,
      progressTotal: 3
    })
  );
  assert.throws(() =>
    jobNotificationInput({
      ...validInput(),
      idempotencyKey: `job-notification:${jobId}:FAILED_FINAL`
    })
  );
});

test("maps rank and frequency jobs to their result pages", () => {
  assert.deepEqual(
    jobNotificationContent(validInput()),
    {
      eventType: "FREQUENCY_COLLECTION",
      label: "Сбор частотности",
      deepLink: `/app/tasks/frequency/${jobId}`,
      severity: "INFO",
      title: "Сбор частотности завершён",
      body: "Обработано: 3 из 3."
    }
  );
  const rank = jobNotificationContent({
    ...validInput(),
    jobType: "MANUAL_RANK_CHECK",
    status: "FAILED_FINAL",
    errorCode: "PROVIDER_UNAVAILABLE",
    idempotencyKey: `job-notification:${jobId}:FAILED_FINAL`
  });
  assert.equal(rank.eventType, "RANK_TRACKING");
  assert.equal(rank.deepLink, `/app/tasks/rank/${jobId}`);
  assert.equal(rank.severity, "CRITICAL");
  assert.match(rank.body, /PROVIDER_UNAVAILABLE/u);
});

function validInput() {
  return {
    workspaceId,
    projectId,
    actorId,
    jobId,
    jobType: "FREQUENCY_COLLECTION",
    status: "COMPLETED" as const,
    progressCurrent: 3,
    progressTotal: 3,
    errorCode: null,
    idempotencyKey: `job-notification:${jobId}:COMPLETED`
  };
}
