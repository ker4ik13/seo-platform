import assert from "node:assert/strict";
import test from "node:test";
import {
  ConflictException,
  NotFoundException
} from "@nestjs/common";
import type {
  InternalIssueRankExecutionGrantInputV1,
  InternalRankExecutionGrantDecisionV1
} from "@seo-platform/contracts";
import type { BillingUsageService } from "../billing/billing-usage.service.js";
import type { PrismaService } from "../database/prisma.service.js";
import type {
  BillingUsageReservation,
  RankExecutionGrantReceipt
} from "../generated/prisma/client.js";
import { RankExecutionGrantSettlementService } from "./rank-execution-grant-settlement.service.js";

const ids = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003",
  membershipId: "01900000-0000-7000-8000-000000000004",
  jobId: "01900000-0000-7000-8000-000000000005",
  jobItemId: "01900000-0000-7000-8000-000000000006",
  manifestId: "01900000-0000-7000-8000-000000000007",
  grantId: "01900000-0000-7000-8000-000000000008",
  reservationId: "01900000-0000-7000-8000-000000000009"
} as const;

test("captures the exact platform-paid reservation in the same transaction", async () => {
  const captures: unknown[][] = [];
  const fixture = serviceFixture(platformInput(), reservation());
  const service = new RankExecutionGrantSettlementService(
    fixture.prisma,
    {
      capture: async (...args: unknown[]) => {
        captures.push(args);
        return {
          id: ids.reservationId,
          status: "CAPTURED",
          amountMinor: 25n,
          includedAmountMinor: 25n,
          prepaidAmountMinor: 0n
        };
      }
    } as unknown as BillingUsageService
  );

  assert.deepEqual(await service.capture(scope()), {
    schemaVersion: "rank-execution-grant-settlement-result@1",
    grantId: ids.grantId,
    status: "CAPTURED"
  });
  assert.equal(captures.length, 1);
  assert.equal(captures[0]?.[0], fixture.transaction);
  assert.equal(captures[0]?.[1], ids.reservationId);
});

test("holds the exact live reservation without capturing it", async () => {
  const holds: unknown[][] = [];
  const fixture = serviceFixture(platformInput(), reservation());
  const service = new RankExecutionGrantSettlementService(
    fixture.prisma,
    {
      hold: async (...args: unknown[]) => {
        holds.push(args);
        return {
          id: ids.reservationId,
          status: "RESERVED",
          amountMinor: 25n,
          includedAmountMinor: 25n,
          prepaidAmountMinor: 0n
        };
      }
    } as unknown as BillingUsageService
  );

  assert.deepEqual(await service.hold(scope()), {
    schemaVersion: "rank-execution-grant-settlement-result@1",
    grantId: ids.grantId,
    status: "RESERVED"
  });
  assert.equal(holds.length, 1);
  assert.equal(holds[0]?.[0], fixture.transaction);
  assert.equal(holds[0]?.[1], ids.reservationId);
});

test("returns NOT_APPLICABLE for BYOK without reading or mutating billing", async () => {
  const input = platformInput({
    credentialMode: "BYOK_API_KEY",
    usageIntent: {
      meter: "RANK_PROVIDER_TASK",
      quantity: "1"
    }
  });
  const fixture = serviceFixture(input, undefined, true);
  const service = new RankExecutionGrantSettlementService(
    fixture.prisma,
    {
      capture: async () => {
        throw new Error("BYOK must not capture billing");
      }
    } as unknown as BillingUsageService
  );

  assert.deepEqual(await service.capture(scope()), {
    schemaVersion: "rank-execution-grant-settlement-result@1",
    grantId: ids.grantId,
    status: "NOT_APPLICABLE"
  });
});

test("hides cross-tenant grants and rejects released reservations", async () => {
  const exact = serviceFixture(platformInput(), reservation());
  const exactService = new RankExecutionGrantSettlementService(
    exact.prisma,
    {} as BillingUsageService
  );
  await assert.rejects(
    exactService.capture({
      ...scope(),
      actorId: "01900000-0000-7000-8000-000000000099"
    }),
    NotFoundException
  );

  const released = serviceFixture(
    platformInput(),
    reservation({ status: "RELEASED" })
  );
  await assert.rejects(
    new RankExecutionGrantSettlementService(
      released.prisma,
      {} as BillingUsageService
    ).capture(scope()),
    ConflictException
  );
});

test("fails closed when reservation price or tenant binding drifts", async () => {
  for (const stored of [
    reservation({ unitPriceMinor: 26n, amountMinor: 26n }),
    reservation({ projectId: "01900000-0000-7000-8000-000000000099" })
  ]) {
    const fixture = serviceFixture(platformInput(), stored);
    await assert.rejects(
      new RankExecutionGrantSettlementService(
        fixture.prisma,
        {} as BillingUsageService
      ).capture(scope()),
      /Stored billing usage reservation is invalid/u
    );
  }
});

test("fails closed when capture returns a drifted terminal result", async () => {
  const fixture = serviceFixture(platformInput(), reservation());
  const service = new RankExecutionGrantSettlementService(
    fixture.prisma,
    {
      capture: async () => ({
        id: ids.reservationId,
        status: "CAPTURED",
        amountMinor: 24n,
        includedAmountMinor: 24n,
        prepaidAmountMinor: 0n
      })
    } as unknown as BillingUsageService
  );

  await assert.rejects(
    service.capture(scope()),
    /Billing usage settlement result is invalid/u
  );
});

function serviceFixture(
  input: InternalIssueRankExecutionGrantInputV1,
  storedReservation?: BillingUsageReservation,
  rejectBillingRead = false
): {
  readonly prisma: PrismaService;
  readonly transaction: object;
} {
  const transaction = {
    rankExecutionGrantReceipt: {
      findUnique: async () => receipt(input)
    },
    billingUsageReservation: {
      findUnique: async () => {
        if (rejectBillingRead) {
          throw new Error("BYOK must not read billing");
        }
        return storedReservation ?? null;
      }
    }
  };
  return {
    transaction,
    prisma: {
      $transaction: async (
        callback: (value: typeof transaction) => Promise<unknown>
      ) => callback(transaction)
    } as unknown as PrismaService
  };
}

function scope() {
  return {
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    grantId: ids.grantId
  };
}

function platformInput(
  overrides: Partial<InternalIssueRankExecutionGrantInputV1> = {}
): InternalIssueRankExecutionGrantInputV1 {
  return {
    schemaVersion: "rank-execution-grant-request@1",
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    membership: { id: ids.membershipId, version: 1 },
    project: {
      version: 1,
      domainHash: hash("a")
    },
    jobId: ids.jobId,
    jobItemId: ids.jobItemId,
    jobVersion: 1,
    executionAttempt: 1,
    purpose: "PROVIDER_SUBMIT",
    provider: "ARSENKIN",
    operation: "POSITIONS",
    capability: "SERP_RANK_TRACKING",
    credentialMode: "PLATFORM_PAID",
    manifest: {
      id: ids.manifestId,
      hash: hash("b"),
      chunkIndex: 0
    },
    executionEvidenceHash: hash("c"),
    policyVersion: "manual-arsenkin-positions@1.0.0",
    usageIntent: {
      meter: "RANK_PROVIDER_TASK",
      quantity: "1",
      unitPriceMinor: "25"
    },
    ...overrides
  };
}

function receipt(
  input: InternalIssueRankExecutionGrantInputV1
): RankExecutionGrantReceipt {
  const decidedAt = "2026-08-27T10:00:00.000Z";
  const decision: InternalRankExecutionGrantDecisionV1 = {
    schemaVersion: "rank-execution-grant-decision@1",
    status: "GRANTED",
    requestHash: hash("d"),
    decidedAt,
    grant: {
      schemaVersion: "rank-execution-grant@1",
      id: ids.grantId,
      requestHash: hash("d"),
      scopeHash: hash("e"),
      issuer: "PLATFORM_API",
      issuedAt: decidedAt,
      expiresAt: "2026-08-27T10:00:30.000Z"
    }
  };
  return {
    id: ids.grantId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actorId: input.actorId,
    jobId: input.jobId,
    jobItemId: input.jobItemId,
    executionAttempt: input.executionAttempt,
    requestSnapshot: input,
    responseSnapshot: decision,
    decision: "GRANTED"
  } as unknown as RankExecutionGrantReceipt;
}

function reservation(
  overrides: Partial<BillingUsageReservation> = {}
): BillingUsageReservation {
  return {
    id: ids.reservationId,
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
    actorId: ids.actorId,
    jobId: ids.jobId,
    jobItemId: ids.jobItemId,
    executionAttempt: 1,
    provider: "ARSENKIN",
    operation: "POSITIONS",
    quantity: 1,
    unitPriceMinor: 25n,
    amountMinor: 25n,
    includedAmountMinor: 25n,
    prepaidAmountMinor: 0n,
    status: "RESERVED",
    businessReference:
      `rank-provider-task:${ids.workspaceId}:${ids.jobItemId}`,
    ...overrides
  } as BillingUsageReservation;
}

function hash(value: string) {
  return {
    algorithm: "SHA_256" as const,
    value: value.repeat(64)
  };
}
