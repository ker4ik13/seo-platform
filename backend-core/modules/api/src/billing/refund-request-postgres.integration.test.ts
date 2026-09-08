import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { AuditService } from "../audit/audit.service.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { BillingLedgerService } from "./billing-ledger.service.js";
import { BillingPiiService } from "./billing-pii.service.js";
import { BillingService } from "./billing.service.js";
import { RefundRequestService } from "./refund-request.service.js";
import { YookassaProviderError, type CreateYookassaPayment, type CreateYookassaRefund, type YookassaPayment, type YookassaRefund } from "./yookassa.client.js";

const databaseUrl = process.env.PLATFORM_API_BILLING_TEST_DATABASE_URL;
test("PostgreSQL customer refund requests require a decision, reserve cash, restore rejected payouts and prevent late duplicate transfers", { skip: !databaseUrl, timeout: 30_000 }, async () => {
  assert.ok(databaseUrl);
  const url = new URL(databaseUrl); assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port && url.port !== "5432");
  const config = loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl, AUTH_DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), WEB_PUBLIC_URL: "https://app.example.test", YOOKASSA_RETURN_URL: "https://app.example.test/app/settings/billing" });
  const prisma = new PrismaService(config);
  const ledger = new BillingLedgerService();
  const audit = new AuditService(prisma);
  let creates = 0; let refundsSent = 0; let refundMode: "success" | "rejected" | "unknown" = "success";
  const payments = new Map<string, YookassaPayment>(); const providerRefunds = new Map<string, YookassaRefund>();
  const gateway = {
    isEnabled: () => true,
    createPayment: async (input: CreateYookassaPayment): Promise<YookassaPayment> => {
      const id = `request-payment-${randomUUID()}`; creates++;
      const row: YookassaPayment = { id, status: "pending", paid: false, amount: { value: (input.amountMinor / 100).toFixed(2), currency: "RUB" }, createdAt: new Date().toISOString(), metadata: { order_id: input.orderId, workspace_id: input.workspaceId }, confirmationUrl: "https://yoomoney.ru/checkout/payments/v2/fixture", test: false, objectHash: createHash("sha256").update(id).digest() };
      payments.set(id, row); return row;
    },
    getPayment: async (id: string) => { const row = payments.get(id); assert.ok(row); return row; },
    createRefund: async (input: CreateYookassaRefund): Promise<YookassaRefund> => {
      refundsSent++;
      if (refundMode === "rejected") throw new YookassaProviderError("YOOKASSA_INVALID_REQUEST", false);
      const id = `request-refund-${input.refundId}`;
      const row: YookassaRefund = { id, paymentId: input.paymentId, status: "succeeded", amount: { value: (input.amountMinor / 100).toFixed(2), currency: "RUB" }, createdAt: new Date().toISOString(), metadata: { refund_id: input.refundId }, objectHash: createHash("sha256").update(id).digest() };
      providerRefunds.set(id, row);
      if (refundMode === "unknown") throw new YookassaProviderError("PAYMENT_PROVIDER_UNAVAILABLE", true);
      return row;
    },
    getRefund: async (id: string) => { const row = providerRefunds.get(id); assert.ok(row); return row; }
  };
  const billing = new BillingService(prisma, ledger, new BillingPiiService(config), gateway as never, audit, config);
  const requests = new RefundRequestService(prisma, ledger, billing, audit);
  const context = { requestId: `refund-test-${randomUUID()}` };
  try {
    const email = `refund-${randomUUID()}@example.invalid`;
    const user = await prisma.user.create({ data: { emailNormalized: email, emailDisplay: email, displayName: "Refund test", status: "ACTIVE", emailVerifiedAt: new Date() } });
    const workspace = await prisma.workspace.create({ data: { name: "Refund test", slug: `refund-${randomUUID()}`, ownerUserId: user.id } });
    const buyer = { buyerType: "INDIVIDUAL" as const, deliveryEmail: email, savePaymentMethod: false, termsAccepted: true as const, termsVersion: "2026-09-07" };
    const topup = await billing.createTopUp(workspace.id, user.id, randomUUID(), { ...buyer, amountMinor: 10_000 }, context);
    async function pay(orderId: string) { const payment = [...payments.values()].find(row => row.metadata.order_id === orderId)!; payments.set(payment.id, { ...payment, status: "succeeded", paid: true, capturedAt: new Date().toISOString() }); await billing.refreshOrder(workspace.id, orderId); }
    await pay(topup.id); assert.equal(creates, 1);
    const balance = async () => (await billing.balance(workspace.id)).prepaidMinor;
    assert.equal(await balance(), 10_000);
    await assert.rejects(() => billing.createRefund(workspace.id, topup.payment.id, user.id, randomUUID(), { amountMinor: 1000, reason: "Direct bypass" }, context), { code: "FORBIDDEN" });
    const key = randomUUID();
    const request = await requests.create(workspace.id, topup.payment.id, user.id, key, { amountMinor: 1000, reason: "Unused data balance" }, context);
    assert.equal((await requests.create(workspace.id, topup.payment.id, user.id, key, { amountMinor: 1000, reason: "Unused data balance" }, context)).id, request.id);
    assert.equal(refundsSent, 0, "Creating a customer request must never call a refund API");
    assert.equal(await balance(), 10_000, "A request awaiting review does not reserve the customer's money");
    const decisions = await Promise.allSettled([requests.decide(request.id, request.version, user.id, "APPROVE", "Unused balance verified", undefined, context), requests.decide(request.id, request.version, user.id, "APPROVE", "Unused balance verified", undefined, context)]);
    assert.equal(decisions.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(await balance(), 9000, "An approved cash refund is unavailable for simultaneous paid SEO usage");
    await requests.reconcile(); await requests.reconcile();
    assert.equal(refundsSent, 1);
    assert.equal(await balance(), 9000, "Settlement debits the hold, not prepaid balance a second time");
    assert.equal((await requests.list(workspace.id)).find(row => row.id === request.id)?.status, "SUCCEEDED");

    const failed = await requests.create(workspace.id, topup.payment.id, user.id, randomUUID(), { amountMinor: 2000, reason: "Unused balance again" }, context);
    await requests.decide(failed.id, failed.version, user.id, "APPROVE", "Approved unused funds", undefined, context);
    assert.equal(await balance(), 7000);
    refundMode = "rejected";
    await assert.rejects(() => requests.reconcile());
    assert.equal(await balance(), 9000, "A definitive provider rejection restores the reserved money");
    assert.equal((await requests.list(workspace.id)).find(row => row.id === failed.id)?.status, "FAILED");

    const unknown = await requests.create(workspace.id, topup.payment.id, user.id, randomUUID(), { amountMinor: 3000, reason: "Review uncertain payout" }, context);
    await requests.decide(unknown.id, unknown.version, user.id, "APPROVE", "Approved remaining funds", undefined, context);
    refundMode = "unknown";
    await assert.rejects(() => requests.reconcile());
    const uncertain = await prisma.billingRefund.findUniqueOrThrow({ where: { refundRequestId: unknown.id } });
    const before = refundsSent;
    await prisma.billingRefund.update({ where: { id: uncertain.id }, data: { createdAt: new Date(Date.now() - 21 * 3_600_000) } });
    await assert.rejects(() => requests.reconcile());
    assert.equal(refundsSent, before, "A missing provider ID cannot trigger another POST after the safe idempotency window");
    assert.equal(await balance(), 6000);
    await requests.reconcileProviderReference(unknown.id, user.id, `request-refund-${uncertain.id}`, context);
    assert.equal((await requests.list(workspace.id)).find(row => row.id === unknown.id)?.status, "SUCCEEDED");
    assert.equal(await balance(), 6000);

    refundMode = "success";
    const subscriptionOrder = await billing.createCheckout(workspace.id, user.id, randomUUID(), { ...buyer, planCode: "SOLO", period: "MONTHLY" }, context);
    await pay(subscriptionOrder.id);
    const initial = await prisma.billingSubscription.findUniqueOrThrow({ where: { workspaceId: workspace.id } });
    assert.ok(initial.serviceValueMinor && initial.serviceValueMinor > 0n);
    const refundSubscription = await requests.create(workspace.id, subscriptionOrder.payment.id, user.id, randomUUID(), { amountMinor: 10_000, reason: "Unused subscription days" }, context);
    await requests.decide(refundSubscription.id, refundSubscription.version, user.id, "APPROVE", "Unused days verified", undefined, context);
    const shortened = await prisma.billingSubscription.findUniqueOrThrow({ where: { workspaceId: workspace.id } });
    assert.ok(shortened.currentPeriodEnd < initial.currentPeriodEnd);
    assert.equal(shortened.cancelAtPeriodEnd, true);
    refundMode = "rejected";
    await assert.rejects(() => requests.reconcile());
    const restored = await prisma.billingSubscription.findUniqueOrThrow({ where: { workspaceId: workspace.id } });
    assert.ok(restored.currentPeriodEnd > shortened.currentPeriodEnd);
    assert.ok(restored.serviceValueMinor! >= initial.serviceValueMinor - 5n, "A failed refund preserves paid service value");
  } finally { await prisma.$disconnect(); }
});
