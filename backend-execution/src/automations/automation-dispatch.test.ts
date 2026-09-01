import assert from "node:assert/strict";
import test from "node:test";
import type { Automation, AutomationRun, Prisma } from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { QueueService } from "../queue/queue.service.js";
import type { RankAutomationDispatchClient } from "../platform-api/rank-automation-dispatch.client.js";
import { AutomationExecutionService } from "./automation-execution.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const automationId = "01900000-0000-7000-8000-000000000004";
const runId = "01900000-0000-7000-8000-000000000005";
const estimateId = "01900000-0000-7000-8000-000000000006";
const jobId = "01900000-0000-7000-8000-000000000007";
const scheduledFor = new Date("2026-09-05T08:30:00.000Z");

test("dispatches a claimed run through Core with its explicit charge cap", async () => {
  let command: unknown;
  let runUpdate: unknown;
  const transaction = {
    $executeRaw: async () => 1,
    automationRun: {
      updateMany: async (input: unknown) => {
        runUpdate = input;
        return { count: 1 };
      }
    },
    automation: { updateMany: async () => ({ count: 1 }) }
  } as unknown as Prisma.TransactionClient;
  const service = new AutomationExecutionService(
    {
      $transaction: async (
        callback: (client: Prisma.TransactionClient) => Promise<unknown>
      ) => callback(transaction)
    } as unknown as PrismaService,
    {
      dispatch: async (input: unknown) => {
        command = input;
        return { estimateId, jobId };
      }
    } as unknown as RankAutomationDispatchClient,
    {} as QueueService
  );

  await (
    service as unknown as {
      dispatch: (automation: Automation, run: AutomationRun) => Promise<void>;
    }
  ).dispatch(automation(), run());

  assert.deepEqual(command, {
    workspaceId,
    projectId,
    actorId,
    automationId,
    automationVersion: 2,
    runId,
    idempotencyKey: `rank-automation-dispatch-${runId}`,
    scheduledFor: scheduledFor.toISOString(),
    trackingContextId: "01900000-0000-7000-8000-000000000008",
    maxPlatformChargeMicro: "12500000"
  });
  assert.deepEqual(runUpdate, {
    where: {
      id: runId,
      automationId,
      status: "RUNNING"
    },
    data: { status: "DISPATCHED", estimateId, jobId }
  });
});

function automation(): Automation {
  return {
    id: automationId,
    workspaceId,
    projectId,
    name: "Ночной съём",
    definition: definition(),
    timezone: "Europe/Moscow",
    enabled: true,
    pausedReason: null,
    nextRunAt: scheduledFor,
    lastRunAt: null,
    consecutiveErr: 0,
    createdBy: actorId,
    updatedBy: actorId,
    idempotencyKey: "rank-automation-create-001",
    version: 2,
    createdAt: scheduledFor,
    updatedAt: scheduledFor
  } as Automation;
}

function run(): AutomationRun {
  return {
    id: runId,
    automationId,
    automationVersion: 2,
    workspaceId,
    projectId,
    status: "RUNNING",
    trigger: "SCHEDULE",
    scheduledFor,
    actorId,
    idempotencyKey: null,
    definition: definition(),
    estimateId: null,
    jobId: null,
    errorCode: null,
    startedAt: scheduledFor,
    finishedAt: null,
    createdAt: scheduledFor,
    updatedAt: scheduledFor
  } as AutomationRun;
}

function definition() {
  return {
    schemaVersion: "rank-tracking-schedule@2",
    trackingContextId: "01900000-0000-7000-8000-000000000008",
    schedule: { cadence: "DAILY", hour: 2, minute: 0 },
    maxItems: 500,
    maxPlatformChargeMicro: "12500000",
    failureThreshold: 3,
    execution: {
      actorId,
      project: {
        id: projectId,
        workspaceId,
        domain: "example.com",
        status: "ACTIVE",
        version: 4
      },
      access: {
        workspaceStatus: "ACTIVE",
        membershipId: "01900000-0000-7000-8000-000000000009",
        membershipVersion: 3,
        canRunRanking: true,
        entitlementStatus: "ALLOWED"
      },
      billingCurrency: "RUB",
      jobCapacity: {
        planCode: "PRO",
        planVersion: 2,
        concurrentJobs: 4
      }
    }
  };
}
