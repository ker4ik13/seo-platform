import assert from "node:assert/strict";
import test from "node:test";
import { AuditService } from "../audit/audit.service.js";
import { BillingPiiService } from "../billing/billing-pii.service.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { uuidV7 } from "../common/uuid-v7.js";
import { PlatformAdminService } from "./platform-admin.service.js";

const databaseUrl = process.env.PLATFORM_API_ADMIN_TEST_DATABASE_URL;

test(
  "PostgreSQL persists register, full cancellation and partial replacement workflows",
  { skip: !databaseUrl },
  async () => {
    const config = loadAppConfig({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl!,
      AUTH_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString("base64url")
    });
    const prisma = new PrismaService(config);
    const pii = new BillingPiiService(config);
    const admin = new PlatformAdminService(
      prisma,
      pii,
      new AuditService(prisma)
    );
    try {
      const partial = await fixture(
        prisma,
        pii,
        "PARTIALLY_REFUNDED",
        300n,
        "REPLACEMENT_REQUIRED"
      );
      const registered = await admin.registerManualNpdReceipt(
        partial.receiptId,
        1,
        registration("partial-original", "Register original before replacement"),
        partial.userId,
        context()
      );
      assert.equal(registered.status, "REPLACEMENT_REQUIRED");
      const replacement = await admin.replaceManualNpdReceipt(
        partial.receiptId,
        2,
        {
          ...registration(
            "partial-replacement",
            "Replace receipt after confirmed partial refund"
          ),
          cancellationOfficialReference: "cancel-partial-original",
          cancelledAt: new Date().toISOString()
        },
        partial.userId,
        context()
      );
      assert.equal(replacement.sequence, 2);
      assert.equal(replacement.grossAmountMinor, 700);
      assert.equal(replacement.status, "DELIVERY_PENDING");
      const original = await prisma.npdReceiptObligation.findUniqueOrThrow({
        where: { id: partial.receiptId }
      });
      assert.equal(original.status, "CANCELLED");
      assert.equal(original.replacementReceiptId, replacement.id);

      const full = await fixture(
        prisma,
        pii,
        "REFUNDED",
        1_000n,
        "CANCELLATION_PENDING"
      );
      const fullRegistered = await admin.registerManualNpdReceipt(
        full.receiptId,
        1,
        registration("full-original", "Register original before cancellation"),
        full.userId,
        context()
      );
      assert.equal(fullRegistered.status, "CANCELLATION_PENDING");
      const cancelled = await admin.cancelManualNpdReceipt(
        full.receiptId,
        2,
        {
          cancellationOfficialReference: "cancel-full-original",
          cancelledAt: new Date().toISOString(),
          reason: "Confirmed full provider refund"
        },
        full.userId,
        context()
      );
      assert.equal(cancelled.status, "CANCELLED");
      assert.ok(cancelled.cancelledAt);
    } finally {
      await prisma.$disconnect();
    }
  }
);

async function fixture(
  prisma: PrismaService,
  pii: BillingPiiService,
  paymentStatus: "PARTIALLY_REFUNDED" | "REFUNDED",
  refundedAmountMinor: bigint,
  receiptStatus: "REPLACEMENT_REQUIRED" | "CANCELLATION_PENDING"
): Promise<{
  readonly receiptId: string;
  readonly userId: string;
}> {
  const userId = uuidV7();
  const workspaceId = uuidV7();
  const orderId = uuidV7();
  const paymentId = uuidV7();
  const receiptId = uuidV7();
  const nonce = userId.slice(-12);
  await prisma.user.create({
    data: {
      id: userId,
      emailNormalized: `${nonce}@admin.test`,
      emailDisplay: `${nonce}@admin.test`,
      emailVerifiedAt: new Date(),
      displayName: "Finance Test",
      status: "ACTIVE"
    }
  });
  await prisma.workspace.create({
    data: {
      id: workspaceId,
      name: `Finance ${nonce}`,
      slug: `finance-${nonce}`,
      ownerUserId: userId
    }
  });
  await prisma.billingOrder.create({
    data: {
      id: orderId,
      workspaceId,
      createdBy: userId,
      kind: "TOP_UP",
      status:
        paymentStatus === "REFUNDED"
          ? "REFUNDED"
          : "PARTIALLY_REFUNDED",
      amountMinor: 1_000n,
      currency: "RUB",
      serviceDescriptionSnapshot: "SEO platform data balance",
      idempotencyKey: `admin-test-${nonce}`,
      requestHash: Buffer.alloc(32, 1),
      termsVersion: "test",
      termsAcceptedAt: new Date(),
      buyerType: "INDIVIDUAL",
      deliveryEmailEncrypted: pii.seal(
        `${nonce}@admin.test`,
        `order:${orderId}:delivery-email`
      )
    }
  });
  await prisma.billingPayment.create({
    data: {
      id: paymentId,
      workspaceId,
      orderId,
      provider: "YOOKASSA",
      externalId: `provider-${nonce}`,
      providerIdempotencyKey: `provider-key-${nonce}`,
      status: paymentStatus,
      amountMinor: 1_000n,
      currency: "RUB",
      refundedAmountMinor,
      verifiedAt: new Date(),
      succeededAt: new Date()
    }
  });
  await prisma.npdReceiptObligation.create({
    data: {
      id: receiptId,
      paymentId,
      yookassaPaymentId: `provider-${nonce}`,
      workspaceId,
      grossAmountMinor: 1_000n,
      currency: "RUB",
      paidAt: new Date(),
      serviceDescriptionSnapshot: "SEO platform data balance",
      buyerType: "INDIVIDUAL",
      deliveryEmailEncrypted: pii.seal(
        `${nonce}@admin.test`,
        `order:${orderId}:delivery-email`
      ),
      status: receiptStatus
    }
  });
  return { receiptId, userId };
}

function registration(officialReceiptId: string, reason: string) {
  return {
    officialReceiptId,
    officialReceiptUrl: `https://lknpd.nalog.ru/api/v1/receipt/220704837033/${officialReceiptId}/print`,
    registeredAt: new Date().toISOString(),
    amountChecked: true as const,
    buyerChecked: true as const,
    reason
  };
}

function context() {
  return { requestId: `admin-test-${uuidV7()}` };
}
