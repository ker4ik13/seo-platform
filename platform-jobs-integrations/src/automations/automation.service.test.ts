import assert from "node:assert/strict";
import test from "node:test";
import type {
  InternalAutomationStatusInput,
  InternalCreateRankTrackingAutomationInput
} from "@seo-platform/contracts";
import type {
  Automation,
  Prisma
} from "../generated/prisma/client.js";
import type { PrismaService } from "../database/prisma.service.js";
import type { QueueService } from "../queue/queue.service.js";
import { AutomationService } from "./automation.service.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const automationId = "01900000-0000-7000-8000-000000000004";
const contextId = "01900000-0000-7000-8000-000000000005";

test("returns a committed pause and defers failed Redis synchronization", async () => {
  const current = automation();
  const paused = {
    ...current,
    enabled: false,
    pausedReason: "MANUAL",
    nextRunAt: null,
    version: 2
  };
  const transaction = {
    $executeRaw: async () => 1,
    automation: {
      findFirst: async () => current,
      update: async () => paused
    }
  } as unknown as Prisma.TransactionClient;
  const service = new AutomationService(
    {
      $transaction: async (
        callback: (
          client: Prisma.TransactionClient
        ) => Promise<unknown>
      ) => callback(transaction)
    } as unknown as PrismaService,
    {
      removeRankAutomationScheduler: async () => {
        throw new Error("redis unavailable");
      }
    } as unknown as QueueService
  );
  silenceLogger(service);

  const result = await service.pause(statusInput());

  assert.equal(result.enabled, false);
  assert.equal(result.pausedReason, "MANUAL");
  assert.equal(result.version, 2);
});

test("reconciliation also removes schedulers for disabled definitions", async () => {
  const disabled = automation({
    enabled: false,
    pausedReason: "MANUAL",
    nextRunAt: null
  });
  let findArguments: unknown;
  let removedId: string | undefined;
  const service = new AutomationService(
    {
      automation: {
        findMany: async (input: unknown) => {
          findArguments = input;
          return [disabled];
        },
        update: async () => disabled
      }
    } as unknown as PrismaService,
    {
      removeRankAutomationScheduler: async (id: string) => {
        removedId = id;
        return true;
      }
    } as unknown as QueueService
  );

  assert.equal(await service.reconcileSchedulers(), 1);
  assert.equal(removedId, automationId);
  assert.equal(
    Object.hasOwn(
      (findArguments as Readonly<Record<string, unknown>>),
      "where"
    ),
    false
  );
});

test("serializes enabled creates and rejects the authoritative plan limit", async () => {
  let created = false;
  const transaction = {
    $executeRaw: async () => 1,
    automation: {
      findUnique: async () => null,
      count: async () => 1,
      create: async () => {
        created = true;
        return automation();
      }
    },
    crawlAutomation: {
      count: async () => 0
    }
  } as unknown as Prisma.TransactionClient;
  const service = new AutomationService(
    {
      automation: { findUnique: async () => null },
      $transaction: async (
        callback: (
          client: Prisma.TransactionClient
        ) => Promise<unknown>
      ) => callback(transaction)
    } as unknown as PrismaService,
    {} as QueueService
  );

  await assert.rejects(
    service.create(createInput()),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 409
  );
  assert.equal(created, false);
});

function createInput(): InternalCreateRankTrackingAutomationInput {
  return {
    name: "Ночной съём",
    trackingContextId: contextId,
    timezone: "Europe/Moscow",
    schedule: { cadence: "DAILY", hour: 2, minute: 0 },
    maxItems: 500,
    failureThreshold: 3,
    enabled: true,
    workspaceId,
    projectId,
    actorId,
    idempotencyKey: "rank-automation-create-001",
    project: {
      id: projectId,
      workspaceId,
      domain: "example.com",
      status: "ACTIVE",
      version: 4
    },
    access: {
      workspaceStatus: "ACTIVE",
      membershipId: "01900000-0000-7000-8000-000000000006",
      membershipVersion: 3,
      canRunRanking: true,
      entitlementStatus: "ALLOWED"
    },
    billingCurrency: "RUB",
    entitlement: {
      planCode: "TRIAL",
      planVersion: 1,
      scheduledAutomations: 1
    }
  };
}

function statusInput(): InternalAutomationStatusInput {
  const input = createInput();
  return {
    workspaceId,
    projectId,
    actorId,
    automationId,
    expectedVersion: 1,
    project: input.project,
    access: input.access,
    billingCurrency: input.billingCurrency,
    entitlement: input.entitlement
  };
}

function automation(
  overrides: Partial<Automation> = {}
): Automation {
  const input = createInput();
  return {
    id: automationId,
    workspaceId,
    projectId,
    name: input.name,
    definition: {
      schemaVersion: "rank-tracking-schedule@1",
      trackingContextId: contextId,
      schedule: input.schedule,
      maxItems: input.maxItems,
      failureThreshold: input.failureThreshold,
      execution: {
        actorId,
        project: input.project,
        access: input.access,
        billingCurrency: input.billingCurrency
      }
    },
    timezone: input.timezone,
    enabled: true,
    pausedReason: null,
    nextRunAt: new Date("2026-08-01T23:00:00.000Z"),
    lastRunAt: null,
    consecutiveErr: 0,
    createdBy: actorId,
    updatedBy: actorId,
    idempotencyKey: input.idempotencyKey,
    version: 1,
    createdAt: new Date("2026-07-31T10:00:00.000Z"),
    updatedAt: new Date("2026-07-31T10:00:00.000Z"),
    ...overrides
  } as Automation;
}

function silenceLogger(service: AutomationService): void {
  (
    service as unknown as {
      logger: { error: (message: string) => void };
    }
  ).logger = { error: () => undefined };
}
