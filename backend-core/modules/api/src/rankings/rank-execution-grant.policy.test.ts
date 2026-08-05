import assert from "node:assert/strict";
import test from "node:test";
import type {
  BillingEntitlementService,
  RankProviderEntitlement
} from "../billing/billing-entitlement.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import {
  CONTROLLED_BETA_DAILY_PROVIDER_TASK_LIMIT,
  CONTROLLED_BETA_RANK_POLICY_VERSION,
  ControlledBetaRankExecutionGrantPolicy
} from "./rank-execution-grant.policy.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const jobItemId = "01900000-0000-7000-8000-000000000005";
const reservationId = "01900000-0000-7000-8000-000000000006";

test("reserves one controlled-beta BYOK provider task in the UTC day", async () => {
  let created: Readonly<Record<string, unknown>> | undefined;
  const policy = policyWithEntitlement("ALLOWED");
  const result = await policy.evaluate(
    {
      $queryRaw: async () => [
        { now: new Date("2026-07-30T23:59:59.000Z") }
      ],
      rankExecutionQuotaReservation: {
        count: async () => CONTROLLED_BETA_DAILY_PROVIDER_TASK_LIMIT - 1,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created = data;
          return { id: reservationId };
        }
      }
    } as unknown as Prisma.TransactionClient,
    input()
  );

  assert.deepEqual(result, {
    entitlement: "ALLOWED",
    quota: "AVAILABLE",
    quotaReservationId: reservationId
  });
  assert.ok(created);
  assert.equal(
    (created.windowStartedAt as Date).toISOString(),
    "2026-07-30T00:00:00.000Z"
  );
  assert.equal(
    (created.windowEndsAt as Date).toISOString(),
    "2026-07-31T00:00:00.000Z"
  );
});

test("denies an unknown policy and exhausts the bounded daily quota", async () => {
  const policy = policyWithEntitlement("ALLOWED");
  const transaction = {
    $queryRaw: async () => [
      { now: new Date("2026-07-30T12:00:00.000Z") }
    ],
    rankExecutionQuotaReservation: {
      count: async () => CONTROLLED_BETA_DAILY_PROVIDER_TASK_LIMIT,
      create: async () => {
        throw new Error("must not create");
      }
    }
  } as unknown as Prisma.TransactionClient;

  assert.deepEqual(
    await policy.evaluate(transaction, {
      ...input(),
      policyVersion: "unknown-policy@1"
    }),
    { entitlement: "DENIED", quota: "NOT_AVAILABLE" }
  );
  assert.deepEqual(await policy.evaluate(transaction, input()), {
    entitlement: "ALLOWED",
    quota: "EXHAUSTED"
  });
});

test("honors a workspace-specific daily provider-task limit", async () => {
  const policy = policyWithEntitlement("ALLOWED", 1_000_000);
  const result = await policy.evaluate(
    {
      $queryRaw: async () => [
        { now: new Date("2026-07-30T12:00:00.000Z") }
      ],
      rankExecutionQuotaReservation: {
        count: async () => CONTROLLED_BETA_DAILY_PROVIDER_TASK_LIMIT,
        create: async () => ({ id: reservationId })
      }
    } as unknown as Prisma.TransactionClient,
    input()
  );

  assert.deepEqual(result, {
    entitlement: "ALLOWED",
    quota: "AVAILABLE",
    quotaReservationId: reservationId
  });
});

test("fails closed before quota reservation when billing entitlement is unavailable", async () => {
  const transaction = {
    $queryRaw: async () => {
      throw new Error("quota clock must not be read");
    },
    rankExecutionQuotaReservation: {
      count: async () => {
        throw new Error("quota must not be read");
      },
      create: async () => {
        throw new Error("quota must not be reserved");
      }
    }
  } as unknown as Prisma.TransactionClient;

  assert.deepEqual(
    await policyWithEntitlement("NOT_AVAILABLE").evaluate(
      transaction,
      input()
    ),
    { entitlement: "NOT_AVAILABLE", quota: "NOT_AVAILABLE" }
  );
  assert.deepEqual(
    await policyWithEntitlement("DENIED").evaluate(transaction, input()),
    { entitlement: "DENIED", quota: "NOT_AVAILABLE" }
  );
});

function policyWithEntitlement(
  result: RankProviderEntitlement,
  dailyTaskLimit = CONTROLLED_BETA_DAILY_PROVIDER_TASK_LIMIT
): ControlledBetaRankExecutionGrantPolicy {
  const entitlements = {
    rankProviderEntitlement: async () => result,
    rankProviderDailyTaskLimit: async () => dailyTaskLimit
  } as unknown as BillingEntitlementService;
  return new ControlledBetaRankExecutionGrantPolicy(entitlements);
}

function input() {
  return {
    workspaceId,
    projectId,
    actorId,
    jobId,
    jobItemId,
    executionAttempt: 1,
    policyVersion: CONTROLLED_BETA_RANK_POLICY_VERSION,
    usageIntent: {
      meter: "RANK_PROVIDER_TASK" as const,
      quantity: 1 as const
    }
  };
}
