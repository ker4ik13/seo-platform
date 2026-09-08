import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { BillingLedgerService } from "./billing-ledger.service.js";
import { BillingPiiService } from "./billing-pii.service.js";
import { BillingService } from "./billing.service.js";
import { CryptoPayProviderError } from "./crypto-pay.client.js";
import type { CreateYookassaPayment, YookassaPayment } from "./yookassa.client.js";
import { BillingNoticeService } from "./billing-notice.service.js";
import { AuthEmailDeliveryService } from "../auth-email/auth-email-delivery.service.js";

const databaseUrl = process.env.PLATFORM_API_BILLING_TEST_DATABASE_URL;

test("PostgreSQL payment settlement isolates providers, survives exact replays and never funds from a test invoice", { skip: !databaseUrl, timeout: 30_000 }, async () => {
  assert.ok(databaseUrl);
  const url = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port && url.port !== "5432", "Use a disposable database cluster");
  const config = loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl, AUTH_DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), WEB_PUBLIC_URL: "https://app.example.test", YOOKASSA_RETURN_URL: "https://app.example.test/app/settings/billing" });
  const prisma = new PrismaService(config);
  const invoices = new Map<string, YookassaPayment>();
  let creates = 0; let unknownNext = false; let testNext = false;
  const gateway = {
    isEnabled: () => true,
    createPayment: async (input: CreateYookassaPayment): Promise<YookassaPayment> => {
      creates++;
      const payment: YookassaPayment = {
        id: String(1000 + creates), status: "pending", paid: false,
        amount: { value: (input.amountMinor / 100).toFixed(2), currency: "RUB" },
        createdAt: new Date().toISOString(), metadata: { order_id: input.orderId, workspace_id: input.workspaceId },
        confirmationUrl: "https://t.me/CryptoBot?start=invoice-fixture", test: testNext,
        objectHash: createHash("sha256").update(input.idempotencyKey).digest()
      };
      testNext = false; invoices.set(payment.id, payment);
      if (unknownNext) { unknownNext = false; throw new CryptoPayProviderError("PROVIDER_OUTCOME_UNKNOWN", true); }
      return payment;
    },
    getPayment: async (id: string) => { const payment = invoices.get(id); assert.ok(payment); return payment; },
    findPayment: async (orderId: string, workspaceId: string) => [...invoices.values()].find(payment => payment.metadata.order_id === orderId && payment.metadata.workspace_id === workspaceId)
  };
  const service = new BillingService(prisma, new BillingLedgerService(), new BillingPiiService(config), gateway as never, new AuditService(prisma), config, gateway as never);
  const context = { requestId: `billing-audit-${randomUUID()}` };
  try {
    const email = `billing-audit-${randomUUID()}@example.invalid`;
    const user = await prisma.user.create({ data: { emailNormalized: email, emailDisplay: email, emailVerifiedAt: new Date(), displayName: "Billing audit", status: "ACTIVE" } });
    const workspace = await prisma.workspace.create({ data: { ownerUserId: user.id, name: "Billing audit", slug: `billing-${randomUUID()}` } });
    await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, roleCode: "OWNER", status: "ACTIVE" } });
    const input = { provider: "CRYPTO_PAY" as const, amountMinor: 10_000, buyerType: "INDIVIDUAL" as const, deliveryEmail: email, savePaymentMethod: false, termsAccepted: true as const, termsVersion: "2026-09-06" };
    const key = randomUUID();
    const order = await service.createTopUp(workspace.id, user.id, key, input, context);
    const invoice = [...invoices.values()].find(payment => payment.metadata.order_id === order.id)!;
    invoices.set(invoice.id, { ...invoice, status: "succeeded", paid: true, capturedAt: new Date().toISOString() });
    await Promise.all([service.refreshOrder(workspace.id, order.id), service.refreshOrder(workspace.id, order.id)]);
    assert.equal((await service.balance(workspace.id)).prepaidMinor, 10_000);
    assert.equal(await prisma.billingLedgerTransaction.count({ where: { businessReference: `crypto-pay:payment:${invoice.id}` } }), 1);
    assert.equal(await prisma.npdReceiptObligation.count({ where: { workspaceId: workspace.id } }), 0);
    assert.equal((await service.createTopUp(workspace.id, user.id, key, input, context)).id, order.id);
    assert.equal(creates, 1);

    unknownNext = true;
    const recoveryKey = randomUUID();
    await assert.rejects(() => service.createTopUp(workspace.id, user.id, recoveryKey, input, context));
    const recovered = await service.createTopUp(workspace.id, user.id, recoveryKey, input, context);
    assert.equal(creates, 2, "A timeout must not trigger a second createInvoice");
    assert.equal(recovered.payment.status, "PENDING");

    testNext = true;
    const testOrder = await service.createTopUp(workspace.id, user.id, randomUUID(), input, context);
    const testInvoice = [...invoices.values()].find(payment => payment.metadata.order_id === testOrder.id)!;
    invoices.set(testInvoice.id, { ...testInvoice, status: "succeeded", paid: true, capturedAt: new Date().toISOString() });
    const confirmed = await service.refreshOrder(workspace.id, testOrder.id);
    assert.equal(confirmed.payment.test, true);
    assert.equal(confirmed.status, "SUCCEEDED");
    const notices = new BillingNoticeService(prisma, config);
    await Promise.all([notices.scan(), notices.scan()]);
    assert.equal(await prisma.billingNotice.count({ where: { workspaceId: workspace.id, kind: "PAYMENT_SUCCEEDED" } }), 1, "Repeated schedulers cannot duplicate real payment notices or send test-payment notices");
    const notice = await prisma.billingNotice.findFirstOrThrow({ where: { workspaceId: workspace.id, kind: "PAYMENT_SUCCEEDED" } });
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: notice.id } });
    assert.deepEqual(event.payload, { noticeId: notice.id, workspaceId: workspace.id });
    assert.equal(JSON.stringify(event.payload).includes(email), false, "No recipient address is persisted in event material");
    const delivery = new AuthEmailDeliveryService(config, prisma, {} as never, new BillingPiiService(config), new AuditService(prisma), notices);
    const material = await delivery.material(event.id);
    assert.equal(material.decision, "READY_NOTICE");
    if (material.decision === "READY_NOTICE") { assert.equal(material.recipient, email); assert.equal(material.amountMinor, 10_000); assert.equal(material.billingUrl, "https://app.example.test/app/settings/billing"); }
    await prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } }, data: { status: "REMOVED" } });
    assert.equal((await delivery.material(event.id)).decision, "SKIPPED", "Delivery rechecks membership immediately before SMTP");
    await prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } }, data: { status: "ACTIVE" } });
    await assert.rejects(() => prisma.billingNotice.update({ where: { id: notice.id }, data: { recipientUserId: randomUUID() } }));
    const plan = await prisma.billingPlanVersion.findFirstOrThrow({ where: { plan: { code: "SOLO" } }, orderBy: { version: "desc" } });
    const periodEnd = new Date(Date.now() + 2 * 86_400_000);
    const subscription = await prisma.billingSubscription.create({ data: { workspaceId: workspace.id, planVersionId: plan.id, status: "ACTIVE", period: "MONTHLY", currency: "RUB", startedAt: new Date(), currentPeriodStart: new Date(), currentPeriodEnd: periodEnd, provider: "CRYPTO_PAY" } });
    await Promise.all([notices.scan(), notices.scan()]);
    assert.equal(await prisma.billingNotice.count({ where: { workspaceId: workspace.id, kind: "SUBSCRIPTION_ENDING_3D" } }), 1);
    const reminder = await prisma.billingNotice.findFirstOrThrow({ where: { workspaceId: workspace.id, kind: "SUBSCRIPTION_ENDING_3D" } });
    const reminderEvent = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: reminder.id } });
    assert.equal((await delivery.material(reminderEvent.id)).decision, "READY_NOTICE");
    await prisma.billingSubscription.update({ where: { id: subscription.id }, data: { currentPeriodEnd: new Date(Date.now() + 32 * 86_400_000), version: { increment: 1 } } });
    assert.equal((await delivery.material(reminderEvent.id)).decision, "SKIPPED", "A renewal invalidates an old queued expiry reminder");
    assert.equal((await service.balance(workspace.id)).prepaidMinor, 10_000, "A test payment must not fund real provider usage");
    assert.equal(await prisma.billingLedgerTransaction.count({ where: { businessReference: `crypto-pay:payment:${testInvoice.id}` } }), 0);

    const pendingInvoice = [...invoices.values()].find(payment => payment.metadata.order_id === recovered.id)!;
    invoices.set(pendingInvoice.id, { ...pendingInvoice, status: "succeeded", paid: true, capturedAt: new Date().toISOString(), amount: { value: "101.00", currency: "RUB" } });
    await assert.rejects(() => service.refreshOrder(workspace.id, recovered.id));
    assert.equal((await service.balance(workspace.id)).prepaidMinor, 10_000, "Amount drift must not produce a ledger credit");
  } finally { await prisma.$disconnect(); }
});
