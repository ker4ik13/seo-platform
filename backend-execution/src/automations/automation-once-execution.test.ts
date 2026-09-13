import assert from "node:assert/strict";
import test from "node:test";
import type { Automation, AutomationRun, Prisma } from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { QueueService } from "../queue/queue.service.js";
import type { RankAutomationDispatchClient } from "../platform-api/rank-automation-dispatch.client.js";
import { AutomationExecutionService } from "./automation-execution.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const automationId = "01900000-0000-7000-8000-000000000003";
const contextId = "01900000-0000-7000-8000-000000000004";
const actorId = "01900000-0000-7000-8000-000000000005";
const scheduledFor = new Date("2026-09-05T08:30:00.000Z");

test("claims a one-time occurrence and disables it in the same transaction", async () => {
  let completionUpdate: unknown;
  const automation = oneTimeAutomation();
  const run = scheduledRun();
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => [{ now: scheduledFor }],
    automation: {
      findUnique: async () => automation,
      updateMany: async (input: unknown) => {
        completionUpdate = input;
        return { count: 1 };
      }
    },
    automationRun: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async () => run
    }
  } as unknown as Prisma.TransactionClient;
  const service = new AutomationExecutionService(
    {
      $transaction: async (
        callback: (client: Prisma.TransactionClient) => Promise<unknown>
      ) => callback(transaction)
    } as unknown as PrismaService,
    {} as RankAutomationDispatchClient,
    {} as QueueService
  );

  const claimed = await (
    service as unknown as {
      claim: (
        id: string,
        version: number,
        occurrence: Date
      ) => Promise<{ automation: Automation; run: AutomationRun } | undefined>;
    }
  ).claim(automationId, 1, scheduledFor);

  assert.equal(claimed?.run.id, run.id);
  assert.deepEqual(completionUpdate, {
    where: { id: automationId, version: 1, enabled: true },
    data: {
      enabled: false,
      pausedReason: "ONE_TIME_COMPLETED",
      nextRunAt: null,
      version: { increment: 1 }
    }
  });
});

function oneTimeAutomation(): Automation {
  return {
    id: automationId,
    workspaceId,
    projectId,
    name: "Отложенный съём",
    definition: {
      schemaVersion: "rank-tracking-schedule@1",
      trackingContextId: contextId,
      schedule: { cadence: "ONCE", runAt: scheduledFor.toISOString() },
      maxItems: 1000,
      failureThreshold: 3,
      execution: {
        actorId,
        project: {
          id: projectId,
          workspaceId,
          domain: "example.com",
          status: "ACTIVE",
          version: 1
        },
        access: {
          workspaceStatus: "ACTIVE",
          membershipId: "01900000-0000-7000-8000-000000000006",
          membershipVersion: 1,
          canRunRanking: true,
          entitlementStatus: "ALLOWED"
        },
        billingCurrency: "RUB",
        jobCapacity: {
          planCode: "PRO",
          planVersion: 1,
          concurrentJobs: 2
        }
      }
    },
    timezone: "Europe/Moscow",
    enabled: true,
    pausedReason: null,
    nextRunAt: scheduledFor,
    lastRunAt: null,
    consecutiveErr: 0,
    createdBy: actorId,
    updatedBy: actorId,
    idempotencyKey: "once-automation-test-001",
    deletedAt: null,
    version: 1,
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    updatedAt: new Date("2026-09-01T10:00:00.000Z")
  } as Automation;
}

function scheduledRun(): AutomationRun {
  return {
    id: "01900000-0000-7000-8000-000000000007",
    automationId,
    automationVersion: 1,
    workspaceId,
    projectId,
    status: "RUNNING",
    trigger: "SCHEDULE",
    scheduledFor,
    actorId,
    idempotencyKey: null,
    definition: oneTimeAutomation().definition,
    estimateId: null,
    jobId: null,
    errorCode: null,
    startedAt: scheduledFor,
    finishedAt: null,
    createdAt: scheduledFor,
    updatedAt: scheduledFor
  } as AutomationRun;
}
