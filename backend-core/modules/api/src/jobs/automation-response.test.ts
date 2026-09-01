import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  scopedAutomation,
  scopedAutomationRuns
} from "./automation-response.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const automationId = "01900000-0000-7000-8000-000000000003";
const runId = "01900000-0000-7000-8000-000000000004";
const contextId = "01900000-0000-7000-8000-000000000005";

const automation = {
  id: automationId,
  workspaceId,
  projectId,
  name: "Ночной съём",
  trackingContextId: contextId,
  timezone: "Europe/Moscow",
  schedule: { cadence: "DAILY", hour: 2, minute: 0 },
  maxPlatformChargeMicro: "0",
  failureThreshold: 3,
  enabled: true,
  nextRunAt: "2026-08-01T23:00:00.000Z",
  consecutiveErrors: 0,
  version: 1,
  createdAt: "2026-07-31T10:00:00.000Z",
  updatedAt: "2026-07-31T10:00:00.000Z"
} as const;

test("accepts a scoped automation and completed run collection", () => {
  assert.deepEqual(
    scopedAutomation(automation, workspaceId, projectId, automationId),
    automation
  );
  const runs = {
    runs: [
      {
        id: runId,
        automationId,
        automationVersion: 1,
        workspaceId,
        projectId,
        status: "COMPLETED",
        trigger: "SCHEDULE",
        scheduledFor: "2026-08-01T23:00:00.000Z",
        estimateId: "01900000-0000-7000-8000-000000000006",
        jobId: "01900000-0000-7000-8000-000000000007",
        startedAt: "2026-08-01T23:00:01.000Z",
        finishedAt: "2026-08-01T23:03:00.000Z",
        createdAt: "2026-08-01T23:00:01.000Z"
      }
    ],
    truncated: false
  } as const;
  assert.deepEqual(
    scopedAutomationRuns(runs, workspaceId, projectId, automationId),
    runs
  );
});

test("rejects cross-tenant or secret-bearing dependency responses", () => {
  for (const value of [
    { ...automation, workspaceId: runId },
    { ...automation, credentialId: runId },
    { ...automation, maxItems: 500 },
    { ...automation, schedule: { cadence: "DAILY", hour: 24, minute: 0 } }
  ]) {
    assert.throws(
      () =>
        scopedAutomation(value, workspaceId, projectId, automationId),
      invalidDependencyResponse
    );
  }
  assert.throws(
    () =>
      scopedAutomationRuns(
        {
          runs: [
            {
              id: runId,
              automationId,
              automationVersion: 1,
              workspaceId,
              projectId: runId,
              status: "FAILED",
              trigger: "MANUAL",
              scheduledFor: "2026-08-01T23:00:00.000Z",
              errorCode: "PROVIDER_TEMPORARY_FAILURE",
              finishedAt: "2026-08-01T23:01:00.000Z",
              createdAt: "2026-08-01T23:00:00.000Z"
            }
          ],
          truncated: false
        },
        workspaceId,
        projectId,
        automationId
      ),
    invalidDependencyResponse
  );
});

test("rejects contradictory automation run lifecycle responses", () => {
  const baseRun = {
    id: runId,
    automationId,
    automationVersion: 1,
    workspaceId,
    projectId,
    trigger: "SCHEDULE",
    scheduledFor: "2026-08-01T23:00:00.000Z",
    createdAt: "2026-08-01T23:00:01.000Z"
  } as const;
  for (const run of [
    {
      ...baseRun,
      status: "RUNNING",
      startedAt: "2026-08-01T23:00:01.000Z",
      finishedAt: "2026-08-01T23:01:00.000Z"
    },
    {
      ...baseRun,
      status: "DISPATCHED",
      startedAt: "2026-08-01T23:00:01.000Z",
      estimateId: "01900000-0000-7000-8000-000000000006"
    },
    {
      ...baseRun,
      status: "COMPLETED",
      finishedAt: "2026-08-01T23:03:00.000Z"
    },
    {
      ...baseRun,
      status: "FAILED",
      errorCode: "PROVIDER_TEMPORARY_FAILURE"
    },
    {
      ...baseRun,
      status: "SKIPPED",
      errorCode: "OVERLAPPING_RUN",
      finishedAt: "2026-08-01T23:00:00.000Z"
    }
  ]) {
    assert.throws(
      () =>
        scopedAutomationRuns(
          { runs: [run], truncated: false },
          workspaceId,
          projectId,
          automationId
        ),
      invalidDependencyResponse
    );
  }
});

function invalidDependencyResponse(error: unknown): boolean {
  return (
    error instanceof DomainError &&
    error.code === "DEPENDENCY_UNAVAILABLE"
  );
}
