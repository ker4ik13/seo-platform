import assert from "node:assert/strict";
import test from "node:test";
import type { BillingUsageReservation } from "../generated/prisma/client.js";
import {
  BillingUsageIdempotencyConflictError,
  BillingUsageInsufficientBalanceError,
  BillingUsageProviderBudgetExceededError,
  BillingUsageReservationExpiredError,
  BillingUsageService,
  type BillingUsageReservationInput
} from "./billing-usage.service.js";

const now = new Date("2026-08-27T10:00:00.000Z");
const input: BillingUsageReservationInput = {
  workspaceId: "0198f2fb-4c00-7000-8000-000000000001",
  projectId: "0198f2fb-4c00-7000-8000-000000000002",
  actorId: "0198f2fb-4c00-7000-8000-000000000003",
  jobId: "0198f2fb-4c00-7000-8000-000000000004",
  jobItemId: "0198f2fb-4c00-7000-8000-000000000005",
  executionAttempt: 1,
  provider: "XMLSTOCK",
  operation: "POSITIONS",
  quantity: 4,
  unitPriceMinor: 25n,
  providerDailySpendLimitMinor: 10_000n,
  providerMonthlySpendLimitMinor: 100_000n,
  businessReference:
    "rank-provider-task:0198f2fb-4c00-7000-8000-000000000005"
};

test("reserves included tokens before prepaid balance with balanced ledger entries", async () => {
  const posts: unknown[] = [];
  const rawSql: string[] = [];
  let created: Record<string, unknown> | undefined;
  let rawCall = 0;
  const ledger = {
    balance: async () => ({
      includedCreditsMinor: 60n,
      prepaidMinor: 1_000n
    }),
    post: async (_transaction: unknown, value: unknown) => {
      posts.push(value);
      return "0198f2fb-4c00-7000-8000-000000000010";
    }
  };
  const transaction = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      rawSql.push(strings.join("?"));
      rawCall += 1;
      if (rawCall === 3) return [{ now }];
      if (rawCall === 4) return [emptyBudgetExposure()];
      return [];
    },
    billingUsageReservation: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created = data;
        return storedReservation(
          data as unknown as Partial<BillingUsageReservation>
        );
      }
    }
  };

  const result = await new BillingUsageService(ledger as never).reserve(
    transaction as never,
    input
  );

  assert.deepEqual(result, {
    id: result.id,
    status: "RESERVED",
    amountMinor: 100n,
    includedAmountMinor: 60n,
    prepaidAmountMinor: 40n
  });
  assert.equal(created?.amountMinor, 100n);
  assert.equal(created?.includedAmountMinor, 60n);
  assert.equal(created?.prepaidAmountMinor, 40n);
  assert.match(rawSql[0] ?? "", /pg_advisory_xact_lock/u);
  assert.match(
    rawSql[3] ?? "",
    /"status" = 'CAPTURED'[\s\S]*"status" = 'RESERVED'/u
  );
  assert.deepEqual(
    (posts[0] as { entries: readonly unknown[] }).entries,
    [
      {
        workspaceId: input.workspaceId,
        accountType: "PROMOTIONAL_LIABILITY",
        direction: "DEBIT",
        amountMinor: 60n
      },
      {
        workspaceId: input.workspaceId,
        accountType: "CUSTOMER_PREPAID_LIABILITY",
        direction: "DEBIT",
        amountMinor: 40n
      },
      {
        workspaceId: input.workspaceId,
        accountType: "RESERVATION",
        direction: "CREDIT",
        amountMinor: 100n
      }
    ]
  );
});

test("rejects an insufficient balance before creating ledger or reservation rows", async () => {
  let postCalled = false;
  let createCalled = false;
  let rawCall = 0;
  const service = new BillingUsageService({
    balance: async () => ({
      includedCreditsMinor: 50n,
      prepaidMinor: 49n
    }),
    post: async () => {
      postCalled = true;
      return "unreachable";
    }
  } as never);
  const transaction = {
    $queryRaw: async () => {
      rawCall += 1;
      if (rawCall === 3) return [{ now }];
      if (rawCall === 4) return [emptyBudgetExposure()];
      return [];
    },
    billingUsageReservation: {
      findUnique: async () => null,
      create: async () => {
        createCalled = true;
      }
    }
  };

  await assert.rejects(
    service.reserve(transaction as never, input),
    BillingUsageInsufficientBalanceError
  );
  assert.equal(postCalled, false);
  assert.equal(createCalled, false);
});

test("replays only the exact billing usage request", async () => {
  let stored: ReturnType<typeof storedReservation> | undefined;
  let postCount = 0;
  let rawCall = 0;
  const service = new BillingUsageService({
    balance: async () => ({
      includedCreditsMinor: 100n,
      prepaidMinor: 0n
    }),
    post: async () => {
      postCount += 1;
      return "0198f2fb-4c00-7000-8000-000000000010";
    }
  } as never);
  const transaction = {
    $queryRaw: async () => {
      rawCall += 1;
      if (rawCall === 3) return [{ now }];
      if (rawCall === 4) return [emptyBudgetExposure()];
      return [];
    },
    billingUsageReservation: {
      findUnique: async () => stored ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        stored = storedReservation(
          data as unknown as Partial<BillingUsageReservation>
        );
        return stored;
      }
    }
  };

  const first = await service.reserve(transaction as never, input);
  const replay = await service.reserve(transaction as never, input);
  assert.deepEqual(replay, first);
  assert.equal(postCount, 1);

  const unusedGrantRetry = await service.reserve(transaction as never, {
    ...input,
    executionAttempt: 2
  });
  assert.deepEqual(unusedGrantRetry, first);
  assert.equal(postCount, 1);

  await assert.rejects(
    service.reserve(transaction as never, {
      ...input,
      unitPriceMinor: 26n
    }),
    BillingUsageIdempotencyConflictError
  );
  assert.equal(postCount, 1);
});

test("serializes and blocks new reservations at daily or monthly provider budgets", async () => {
  const cases = [
    {
      window: "DAILY" as const,
      limits: {
        providerDailySpendLimitMinor: 159n,
        providerMonthlySpendLimitMinor: 1_000n
      },
      exposure: {
        dailyCapturedMinor: "40",
        monthlyCapturedMinor: "200",
        reservedMinor: "20"
      }
    },
    {
      window: "MONTHLY" as const,
      limits: {
        providerDailySpendLimitMinor: 300n,
        providerMonthlySpendLimitMinor: 300n
      },
      exposure: {
        dailyCapturedMinor: "40",
        monthlyCapturedMinor: "200",
        reservedMinor: "20"
      }
    }
  ];

  for (const budgetCase of cases) {
    let rawCall = 0;
    let balanceCalled = false;
    const service = new BillingUsageService({
      balance: async () => {
        balanceCalled = true;
        throw new Error("budget must be checked before workspace balance");
      }
    } as never);
    const transaction = {
      $queryRaw: async () => {
        rawCall += 1;
        if (rawCall === 3) return [{ now }];
        if (rawCall === 4) return [budgetCase.exposure];
        return [];
      },
      billingUsageReservation: {
        findUnique: async () => null,
        create: async () => {
          throw new Error("exhausted budget must not create a reservation");
        }
      }
    };

    await assert.rejects(
      service.reserve(transaction as never, {
        ...input,
        ...budgetCase.limits
      }),
      (error: unknown) =>
        error instanceof BillingUsageProviderBudgetExceededError &&
        error.window === budgetCase.window
    );
    assert.equal(rawCall, 4);
    assert.equal(balanceCalled, false);
  }
});

test("captures once, rejects expired capture and releases the original balance split", async () => {
  const active = storedReservation({
    id: "0198f2fb-4c00-7000-8000-000000000020",
    amountMinor: 100n,
    includedAmountMinor: 60n,
    prepaidAmountMinor: 40n,
    reservedAt: now,
    expiresAt: new Date(now.getTime() + 60_000)
  });
  const capturePosts: Array<Record<string, unknown>> = [];
  let captureRawCall = 0;
  const captureService = new BillingUsageService({
    post: async (_transaction: unknown, value: Record<string, unknown>) => {
      capturePosts.push(value);
      return "0198f2fb-4c00-7000-8000-000000000021";
    }
  } as never);
  const captured = await captureService.capture(
    {
      $queryRaw: async () => {
        captureRawCall += 1;
        return captureRawCall === 1
          ? []
          : [{ now: new Date(now.getTime() + 1_000) }];
      },
      billingUsageReservation: {
        findUnique: async () => active,
        update: async ({ data }: { data: Record<string, unknown> }) => ({
          ...active,
          ...data
        })
      }
    } as never,
    active.id
  );
  assert.equal(captured.status, "CAPTURED");
  assert.deepEqual(capturePosts[0]?.entries, [
    {
      workspaceId: input.workspaceId,
      accountType: "RESERVATION",
      direction: "DEBIT",
      amountMinor: 100n
    },
    {
      accountType: "PROVIDER_COST",
      direction: "CREDIT",
      amountMinor: 100n
    }
  ]);

  let expiredPostCalled = false;
  let expiredRawCall = 0;
  const expiredService = new BillingUsageService({
    post: async () => {
      expiredPostCalled = true;
    }
  } as never);
  await assert.rejects(
    expiredService.capture(
      {
        $queryRaw: async () => {
          expiredRawCall += 1;
          return expiredRawCall === 1
            ? []
            : [{ now: active.expiresAt }];
        },
        billingUsageReservation: { findUnique: async () => active }
      } as never,
      active.id
    ),
    BillingUsageReservationExpiredError
  );
  assert.equal(expiredPostCalled, false);

  const releasePosts: Array<Record<string, unknown>> = [];
  let releaseRawCall = 0;
  const released = await new BillingUsageService({
    post: async (_transaction: unknown, value: Record<string, unknown>) => {
      releasePosts.push(value);
      return "0198f2fb-4c00-7000-8000-000000000022";
    }
  } as never).release(
    {
      $queryRaw: async () => {
        releaseRawCall += 1;
        return releaseRawCall === 1
          ? []
          : [{ now: new Date(now.getTime() + 2_000) }];
      },
      billingUsageReservation: {
        findUnique: async () => active,
        update: async ({ data }: { data: Record<string, unknown> }) => ({
          ...active,
          ...data
        })
      }
    } as never,
    active.id
  );
  assert.equal(released.status, "RELEASED");
  assert.deepEqual(releasePosts[0]?.entries, [
    {
      workspaceId: input.workspaceId,
      accountType: "RESERVATION",
      direction: "DEBIT",
      amountMinor: 100n
    },
    {
      workspaceId: input.workspaceId,
      accountType: "PROMOTIONAL_LIABILITY",
      direction: "CREDIT",
      amountMinor: 60n
    },
    {
      workspaceId: input.workspaceId,
      accountType: "CUSTOMER_PREPAID_LIABILITY",
      direction: "CREDIT",
      amountMinor: 40n
    }
  ]);
});

test("holds only a live reservation for a bounded provider window", async () => {
  const active = storedReservation({
    expiresAt: new Date(now.getTime() + 10_000)
  });
  let rawCall = 0;
  let heldUntil: Date | undefined;
  const service = new BillingUsageService({} as never);
  const held = await service.hold(
    {
      $queryRaw: async () => {
        rawCall += 1;
        return rawCall === 1
          ? []
          : [{ now: new Date(now.getTime() + 1_000) }];
      },
      billingUsageReservation: {
        findUnique: async () => active,
        update: async ({ data }: { data: { expiresAt: Date } }) => {
          heldUntil = data.expiresAt;
          return { ...active, ...data };
        }
      }
    } as never,
    active.id
  );
  assert.equal(held.status, "RESERVED");
  assert.equal(
    heldUntil?.toISOString(),
    "2026-08-27T10:01:01.000Z"
  );

  let expiredRawCall = 0;
  await assert.rejects(
    service.hold(
      {
        $queryRaw: async () => {
          expiredRawCall += 1;
          return expiredRawCall === 1 ? [] : [{ now }];
        },
        billingUsageReservation: {
          findUnique: async () => storedReservation({ expiresAt: now })
        }
      } as never,
      active.id
    ),
    BillingUsageReservationExpiredError
  );
});

test("releases only the locked bounded batch of expired reservations", async () => {
  const expired = storedReservation({
    id: "0198f2fb-4c00-7000-8000-000000000030",
    expiresAt: new Date(now.getTime() - 1)
  });
  let rawCall = 0;
  let updated = 0;
  const service = new BillingUsageService({
    post: async () =>
      "0198f2fb-4c00-7000-8000-000000000031"
  } as never);
  const released = await service.releaseExpired(
    {
      $queryRaw: async () => {
        rawCall += 1;
        if (rawCall === 1) return [{ id: expired.id }];
        if (rawCall === 2) return [];
        return [{ now }];
      },
      billingUsageReservation: {
        findUnique: async () => expired,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updated += 1;
          return { ...expired, ...data };
        }
      }
    } as never,
    25
  );
  assert.equal(released, 1);
  assert.equal(updated, 1);
  await assert.rejects(
    service.releaseExpired({} as never, 101),
    /Invalid billing usage release batch size/u
  );
});

function storedReservation(
  overrides: Partial<BillingUsageReservation> = {}
): BillingUsageReservation {
  return {
    id: "0198f2fb-4c00-7000-8000-000000000011",
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorId: input.actorId,
    jobId: input.jobId,
    jobItemId: input.jobItemId,
    executionAttempt: input.executionAttempt,
    provider: input.provider,
    operation: input.operation,
    quantity: input.quantity,
    unitPriceMinor: input.unitPriceMinor,
    amountMinor: 100n,
    includedAmountMinor: 100n,
    prepaidAmountMinor: 0n,
    status: "RESERVED",
    businessReference: input.businessReference,
    requestHash: new Uint8Array(32),
    reservationTransactionId:
      "0198f2fb-4c00-7000-8000-000000000010",
    captureTransactionId: null,
    releaseTransactionId: null,
    reservedAt: now,
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    capturedAt: null,
    releasedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function emptyBudgetExposure() {
  return {
    dailyCapturedMinor: "0",
    monthlyCapturedMinor: "0",
    reservedMinor: "0"
  };
}
