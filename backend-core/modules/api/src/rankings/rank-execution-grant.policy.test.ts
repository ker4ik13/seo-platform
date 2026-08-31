import assert from "node:assert/strict";
import test from "node:test";
import type {
  BillingEntitlementService,
  RankProviderEntitlement
} from "../billing/billing-entitlement.service.js";
import {
  BillingUsageInsufficientBalanceError,
  BillingUsageProviderBudgetExceededError,
  type BillingUsageService
} from "../billing/billing-usage.service.js";
import type { AppConfig } from "../config/app-config.js";
import type { Prisma } from "../generated/prisma/client.js";
import {
  CONTROLLED_BETA_RANK_POLICY_VERSION,
  ControlledBetaRankExecutionGrantPolicy
} from "./rank-execution-grant.policy.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const jobId = "01900000-0000-7000-8000-000000000004";
const jobItemId = "01900000-0000-7000-8000-000000000005";
const reservationId = "01900000-0000-7000-8000-000000000006";

test("records one BYOK provider grant without enforcing a daily cap", async () => {
  let created: Readonly<Record<string, unknown>> | undefined;
  const policy = policyWithEntitlement("ALLOWED");
  const result = await policy.evaluate(
    {
      $queryRaw: async () => [
        { now: new Date("2026-07-30T23:59:59.000Z") }
      ],
      rankExecutionQuotaReservation: {
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
    quota: "UNLIMITED",
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

test("denies an unknown policy without consulting historical usage", async () => {
  const policy = policyWithEntitlement("ALLOWED");
  const transaction = {
    $queryRaw: async () => [
      { now: new Date("2026-07-30T12:00:00.000Z") }
    ],
    rankExecutionQuotaReservation: {
      count: async () => {
        throw new Error("historical usage must not be counted");
      },
      create: async () => ({ id: reservationId })
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
    quota: "UNLIMITED",
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

test("reserves configured platform tokens without capturing before provider submit", async () => {
  const calls: string[] = [];
  const usage = {
    reserve: async (_transaction: unknown, value: {
      unitPriceMinor: bigint;
      providerDailySpendLimitMinor: bigint;
      providerMonthlySpendLimitMinor: bigint;
      businessReference: string;
    }) => {
      calls.push(`reserve:${value.unitPriceMinor}`);
      calls.push(`daily-budget:${value.providerDailySpendLimitMinor}`);
      calls.push(`monthly-budget:${value.providerMonthlySpendLimitMinor}`);
      calls.push(`reference:${value.businessReference}`);
      return {
        id: reservationId,
        status: "RESERVED",
        amountMinor: 25n,
        includedAmountMinor: 25n,
        prepaidAmountMinor: 0n
      };
    }
  } as unknown as BillingUsageService;
  const policy = policyWithEntitlement("ALLOWED", usage, true);
  const result = await policy.evaluate(
    transactionWithQuotaReservation(),
    {
      ...input(),
      credentialMode: "PLATFORM_PAID",
      usageIntent: {
        ...input().usageIntent,
        unitPriceMinor: "25"
      }
    }
  );

  assert.deepEqual(calls, [
    "reserve:25",
    "daily-budget:1000",
    "monthly-budget:10000",
    `reference:rank-provider-task:${workspaceId}:${jobItemId}`
  ]);
  assert.deepEqual(result, {
    entitlement: "ALLOWED",
    quota: "UNLIMITED",
    quotaReservationId: reservationId
  });
});

test("denies platform execution when tokens are insufficient", async () => {
  const usage = {
    reserve: async () => {
      throw new BillingUsageInsufficientBalanceError();
    }
  } as unknown as BillingUsageService;
  const result = await policyWithEntitlement("ALLOWED", usage, true).evaluate(
    transactionWithQuotaReservation(),
    {
      ...input(),
      credentialMode: "PLATFORM_PAID",
      usageIntent: {
        ...input().usageIntent,
        unitPriceMinor: "25"
      }
    }
  );

  assert.deepEqual(result, {
    entitlement: "ALLOWED",
    quota: "EXHAUSTED"
  });
});

test("stops platform execution when the provider hard budget is exhausted", async () => {
  const usage = {
    reserve: async () => {
      throw new BillingUsageProviderBudgetExceededError("DAILY");
    }
  } as unknown as BillingUsageService;
  const result = await policyWithEntitlement("ALLOWED", usage, true).evaluate(
    transactionWithQuotaReservation(),
    {
      ...input(),
      credentialMode: "PLATFORM_PAID",
      usageIntent: {
        ...input().usageIntent,
        unitPriceMinor: "25"
      }
    }
  );

  assert.deepEqual(result, {
    entitlement: "ALLOWED",
    quota: "EXHAUSTED"
  });
});

function policyWithEntitlement(
  result: RankProviderEntitlement,
  usage: BillingUsageService = {
    reserve: async () => {
      throw new Error("BYOK must not reserve platform tokens");
    }
  } as unknown as BillingUsageService,
  platformEnabled = false
): ControlledBetaRankExecutionGrantPolicy {
  const entitlements = {
    rankProviderEntitlement: async () => result
  } as unknown as BillingEntitlementService;
  const config = {
    billing: {
      providerUsage: {
        ARSENKIN: {
          enabled: platformEnabled,
          ...(platformEnabled
            ? {
                rankKeywordPriceMinor: 25,
                dailySpendLimitMinor: 1_000,
                monthlySpendLimitMinor: 10_000
              }
            : {})
        },
        XMLSTOCK: { enabled: false }
      }
    }
  } as unknown as AppConfig;
  return new ControlledBetaRankExecutionGrantPolicy(
    entitlements,
    usage,
    config
  );
}

function transactionWithQuotaReservation(): Prisma.TransactionClient {
  return {
    $queryRaw: async () => [
      { now: new Date("2026-07-30T23:59:59.000Z") }
    ],
    rankExecutionQuotaReservation: {
      create: async () => ({ id: reservationId })
    }
  } as unknown as Prisma.TransactionClient;
}

function input() {
  return {
    workspaceId,
    projectId,
    actorId,
    jobId,
    jobItemId,
    executionAttempt: 1,
    provider: "ARSENKIN" as const,
    credentialMode: "BYOK_API_KEY" as const,
    policyVersion: CONTROLLED_BETA_RANK_POLICY_VERSION,
    usageIntent: {
      meter: "RANK_PROVIDER_TASK" as const,
      quantity: 1 as const
    }
  };
}
