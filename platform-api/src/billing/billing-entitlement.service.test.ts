import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "../generated/prisma/client.js";
import { DomainError } from "../common/domain-error.js";
import type { PrismaService } from "../database/prisma.service.js";
import { BillingEntitlementService } from "./billing-entitlement.service.js";
import { billingPlanFeatures } from "./billing-plan-features.js";

const WORKSPACE_ID = "01900000-0000-7000-8000-000000000001";
const NOW = new Date("2026-07-31T00:00:00.000Z");

test("strictly parses the published plan feature contract", () => {
  const features = billingPlanFeatures(planFeatures());
  assert.equal(features.projects, 1);
  assert.equal(features.seats, 1);
  assert.equal(features.byok, true);
  assert.throws(
    () =>
      billingPlanFeatures({
        ...planFeatures(),
        projects: 1.5
      }),
    /Invalid billing plan feature projects/u
  );
});

test("projects the exact trusted semantic capacity snapshot", async () => {
  const transaction = onboardingTransaction();
  const service = new BillingEntitlementService({
    $transaction: async (
      callback: (
        client: Prisma.TransactionClient
      ) => Promise<unknown>
    ) => callback(transaction)
  } as unknown as PrismaService);

  assert.deepEqual(await service.semanticCapacity(WORKSPACE_ID), {
    planCode: "TRIAL",
    planVersion: 1,
    storedKeywords: 25_000,
    keywordsPerProject: 25_000,
    trackedContextPairs: 500
  });
});

test("serializes project capacity and rejects the exact current-plan limit", async () => {
  const queries: string[] = [];
  const transaction = onboardingTransaction({
    queries,
    projectCount: 1
  });
  const service = new BillingEntitlementService({} as PrismaService);

  await assert.rejects(
    service.assertCanCreateProject(transaction, WORKSPACE_ID),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "QUOTA_EXCEEDED" &&
      error.details?.resource === "projects" &&
      error.details?.current === 1 &&
      error.details?.limit === 1
  );
  assert.match(queries[0] ?? "", /FROM "workspaces"/u);
  assert.match(queries[0] ?? "", /FOR UPDATE/u);
});

test("counts live invitations as reserved seats and gates CLIENT by plan", async () => {
  const service = new BillingEntitlementService({} as PrismaService);
  const atSeatLimit = onboardingTransaction({
    memberCount: 1,
    pendingInviteCount: 0
  });
  await assert.rejects(
    service.assertCanCreateInvite(
      atSeatLimit,
      WORKSPACE_ID,
      "VIEWER"
    ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "QUOTA_EXCEEDED" &&
      error.details?.resource === "seats"
  );

  const clientRoleUnavailable = onboardingTransaction({
    memberCount: 0,
    pendingInviteCount: 0
  });
  await assert.rejects(
    service.assertCanCreateInvite(
      clientRoleUnavailable,
      WORKSPACE_ID,
      "CLIENT"
    ),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "FEATURE_NOT_AVAILABLE" &&
      error.details?.feature === "clientRole"
  );
});

test("denies provider execution for an expired subscription without falling back to trial", async () => {
  const transaction = {
    $queryRaw: async () => [{ now: NOW }],
    billingSubscription: {
      findUnique: async () => ({
        status: "TRIALING",
        currentPeriodEnd: new Date("2026-07-30T23:59:59.000Z"),
        graceEnd: null,
        planVersion: {
          version: 1,
          features: planFeatures(),
          plan: { code: "TRIAL" }
        }
      })
    }
  } as unknown as Prisma.TransactionClient;
  const service = new BillingEntitlementService({} as PrismaService);

  assert.equal(
    await service.rankProviderEntitlement(transaction, WORKSPACE_ID),
    "NOT_AVAILABLE"
  );
});

function onboardingTransaction(
  options: {
    readonly queries?: string[];
    readonly projectCount?: number;
    readonly memberCount?: number;
    readonly pendingInviteCount?: number;
  } = {}
): Prisma.TransactionClient {
  return {
    $queryRaw: async (parts: TemplateStringsArray) => {
      const query = parts.join("?");
      options.queries?.push(query);
      return query.includes('FROM "workspaces"')
        ? [{ status: "ACTIVE" }]
        : [{ now: NOW }];
    },
    billingSubscription: {
      findUnique: async () => null
    },
    billingPlanVersion: {
      findFirst: async () => ({
        version: 1,
        features: planFeatures(),
        plan: { code: "TRIAL" }
      })
    },
    project: {
      count: async () => options.projectCount ?? 0
    },
    workspaceMember: {
      count: async () => options.memberCount ?? 0
    },
    workspaceInvite: {
      count: async () => options.pendingInviteCount ?? 0
    }
  } as unknown as Prisma.TransactionClient;
}

function planFeatures() {
  return {
    seats: 1,
    projects: 1,
    storedKeywords: 25_000,
    keywordsPerProject: 25_000,
    trackedContextPairs: 500,
    storageBytes: 536_870_912,
    rawSerpRetentionDays: 7,
    scheduledAutomations: 1,
    guestReports: 0,
    byok: true,
    publicApi: "SANDBOX",
    clientRole: false,
    whiteLabel: false,
    queuePriority: "TRIAL"
  } as const;
}
