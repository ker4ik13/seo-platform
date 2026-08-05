import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../audit/audit.service.js";
import type { BillingService } from "../billing/billing.service.js";
import { uuidV7 } from "../common/uuid-v7.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { DomainError } from "../common/domain-error.js";
import { PlatformAdminWorkspaceService } from "./platform-admin-workspace.service.js";

const databaseUrl = process.env.PLATFORM_API_ADMIN_TEST_DATABASE_URL;

test(
  "PostgreSQL grants an audited idempotent manual workspace subscription",
  { skip: !databaseUrl },
  async () => {
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl!,
      AUTH_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 29).toString("base64url")
    });
    const prisma = new PrismaService(config);
    const admin = new PlatformAdminWorkspaceService(
      prisma,
      { plans: async () => [] } as unknown as BillingService,
      new AuditService(prisma)
    );
    const userId = uuidV7();
    const workspaceId = uuidV7();
    const nonce = workspaceId.slice(-12);
    const requestId = `admin-workspace-test-${uuidV7()}`;
    try {
      await prisma.user.create({
        data: {
          id: userId,
          emailNormalized: `${nonce}@admin.test`,
          emailDisplay: `${nonce}@admin.test`,
          emailVerifiedAt: new Date(),
          displayName: "Workspace Admin Test",
          status: "ACTIVE"
        }
      });
      await prisma.workspace.create({
        data: {
          id: workspaceId,
          name: `Workspace ${nonce}`,
          slug: `workspace-${nonce}`,
          ownerUserId: userId
        }
      });
      const planVersion = await prisma.billingPlanVersion.findFirstOrThrow({
        where: {
          version: 3,
          status: "PUBLISHED",
          plan: { code: "AGENCY", status: "ACTIVE" }
        },
        include: { plan: true }
      });
      const search = await admin.searchWorkspaces(`${nonce}@admin.test`);
      assert.equal(search.data.length, 1);
      assert.equal(search.data[0]?.id, workspaceId);
      assert.equal(search.data[0]?.owner.displayName, "Workspace Admin Test");

      const now = new Date();
      const input = {
        planCode: planVersion.plan.code,
        planVersion: planVersion.version,
        currentPeriodEnd: addYears(now, 5).toISOString(),
        confirmWorkspaceId: workspaceId,
        confirmed: true as const,
        reason: "Five year complimentary production subscription"
      };
      const first = await admin.grantSubscription(
        workspaceId,
        input,
        { createOnly: true },
        userId,
        `workspace-grant-${nonce}`,
        { requestId },
        now
      );
      assert.equal(first.planCode, "AGENCY");
      assert.equal(first.planVersion, 3);
      assert.equal(first.version, 1);

      const replay = await admin.grantSubscription(
        workspaceId,
        input,
        { createOnly: true },
        userId,
        `workspace-grant-${nonce}`,
        { requestId },
        now
      );
      assert.deepEqual(replay, first);
      assert.equal(
        await prisma.platformAdminCommandReceipt.count({
          where: { workspaceId }
        }),
        1
      );
      assert.equal(
        await prisma.auditEvent.count({
          where: {
            workspaceId,
            action: "platform_admin.workspace_subscription.granted"
          }
        }),
        1
      );

      await assert.rejects(
        () =>
          admin.grantSubscription(
            workspaceId,
            { ...input, reason: "Another reason for the same key" },
            { createOnly: true },
            userId,
            `workspace-grant-${nonce}`,
            { requestId },
            now
          ),
        (error: unknown) =>
          error instanceof DomainError && error.code === "IDEMPOTENCY_CONFLICT"
      );

      const paymentMethod = await prisma.billingPaymentMethod.create({
        data: {
          workspaceId,
          provider: "YOOKASSA",
          externalId: `admin-method-${nonce}`,
          type: "bank_card",
          status: "ACTIVE",
          consentedAt: now
        }
      });
      await prisma.billingSubscription.update({
        where: { workspaceId },
        data: {
          provider: "YOOKASSA",
          externalSubscriptionId: `admin-subscription-${nonce}`,
          defaultPaymentMethodId: paymentMethod.id
        }
      });
      const updated = await admin.grantSubscription(
        workspaceId,
        {
          ...input,
          currentPeriodEnd: addYears(now, 1).toISOString(),
          reason: "Replace provider billing with a manual subscription"
        },
        { createOnly: false, expectedVersion: 1 },
        userId,
        `workspace-update-${nonce}`,
        { requestId },
        now
      );
      assert.equal(updated.version, 2);
      const stored = await prisma.billingSubscription.findUniqueOrThrow({
        where: { workspaceId }
      });
      assert.equal(stored.provider, null);
      assert.equal(stored.externalSubscriptionId, null);
      assert.equal(stored.defaultPaymentMethodId, null);
    } finally {
      await prisma.auditEvent.deleteMany({ where: { workspaceId } });
      await prisma.platformAdminCommandReceipt.deleteMany({
        where: { workspaceId }
      }).catch(() => undefined);
      await prisma.billingSubscription.deleteMany({ where: { workspaceId } });
      await prisma.billingPaymentMethod.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    }
  }
);

function addYears(value: Date, years: number): Date {
  const result = new Date(value);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  result.setUTCSeconds(result.getUTCSeconds() - 1);
  return result;
}
