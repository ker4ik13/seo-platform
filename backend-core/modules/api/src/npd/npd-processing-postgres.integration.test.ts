import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { BillingPiiService } from "../billing/billing-pii.service.js";
import { NpdProcessingGuard } from "./npd-processing.controller.js";
import { NpdProcessingService } from "./npd-processing.service.js";

const databaseUrl = process.env.PLATFORM_API_NPD_TEST_DATABASE_URL;
test("NPD control rejects disabled processing and a foreign worker token", () => {
  const token = randomBytes(32).toString("base64url");
  const context = (authorization: string) => ({ switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }) }) as ExecutionContext;
  const common = { NODE_ENV: "test", DATABASE_URL: "postgresql://test:test@127.0.0.1:55432/npd_unit" };
  const disabled = new NpdProcessingGuard(loadAppConfig(common));
  assert.throws(() => disabled.canActivate(context(`Bearer ${token}`)));
  const enabled = new NpdProcessingGuard(loadAppConfig({ ...common, NPD_RECEIPTS_ENABLED: "true", NPD_PROCESSOR_API_TOKEN: token }));
  assert.throws(() => enabled.canActivate(context("Bearer another-worker-token")));
  assert.equal(enabled.canActivate(context(`Bearer ${token}`)), true);
});

test("PostgreSQL NPD claims, send marker, unknown recovery and refund race never issue twice", { skip: !databaseUrl, timeout: 30_000 }, async () => {
  assert.ok(databaseUrl);
  const url = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port && url.port !== "5432", "Disposable cluster required");
  const config = loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl, AUTH_DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64url") });
  const prisma = new PrismaService(config), pii = new BillingPiiService(config), processing = new NpdProcessingService(prisma, pii);
  try {
    const email = `npd-${randomUUID()}@example.invalid`;
    const user = await prisma.user.create({ data: { emailNormalized: email, emailDisplay: email, displayName: "NPD audit", status: "ACTIVE", emailVerifiedAt: new Date() } });
    const workspace = await prisma.workspace.create({ data: { name: "NPD audit", slug: `npd-${randomUUID()}`, ownerUserId: user.id } });
    async function fixture(options: { test?: boolean; provider?: "YOOKASSA" | "CRYPTO_PAY"; badBuyer?: boolean } = {}) {
      const id = randomUUID(), paymentId = randomUUID();
      const encryptedEmail = pii.seal(email, `order:${id}:delivery-email`);
      await prisma.billingOrder.create({ data: { id, workspaceId: workspace.id, createdBy: user.id, kind: "TOP_UP", status: "SUCCEEDED", amountMinor: 12_345n, currency: "RUB", serviceDescriptionSnapshot: "Тест регистрации чека", idempotencyKey: randomUUID(), requestHash: randomBytes(32), termsVersion: "test", termsAcceptedAt: new Date(), buyerType: "INDIVIDUAL", deliveryEmailEncrypted: encryptedEmail } });
      await prisma.billingPayment.create({ data: { id: paymentId, workspaceId: workspace.id, orderId: id, provider: options.provider ?? "YOOKASSA", externalId: randomUUID(), providerIdempotencyKey: randomUUID(), status: "SUCCEEDED", amountMinor: 12_345n, currency: "RUB", isTest: options.test ?? false, succeededAt: new Date() } });
      return prisma.npdReceiptObligation.create({ data: { workspaceId: workspace.id, paymentId, yookassaPaymentId: randomUUID(), grossAmountMinor: 12_345n, currency: "RUB", paidAt: new Date(), serviceDescriptionSnapshot: "Тест регистрации чека", buyerType: "INDIVIDUAL", deliveryEmailEncrypted: encryptedEmail, ...(options.badBuyer ? { buyerNameEncrypted: "damaged-envelope" } : {}) } });
    }
    await fixture({ test: true });
    await fixture({ provider: "CRYPTO_PAY" });
    assert.equal(await processing.claim(), null, "Test payments and Crypto invoices must not issue NPD receipts");
    const receipt = await fixture();
    const claims = (await Promise.all([processing.claim(), processing.claim()])).filter(value => value !== null);
    assert.equal(claims.length, 1);
    const claim = claims[0]!;
    assert.equal(claim.receiptId, receipt.id);
    assert.equal(claim.amountMinor, "12345");
    assert.equal("deliveryEmail" in claim, false, "Worker does not need the buyer's email");
    await assert.rejects(() => processing.start(receipt.id, randomUUID()));
    const senders = await Promise.allSettled([processing.start(receipt.id, claim.leaseToken), processing.start(receipt.id, claim.leaseToken)]);
    assert.equal(senders.filter(result => result.status === "fulfilled").length, 1);
    await prisma.npdReceiptObligation.update({ where: { id: receipt.id }, data: { issueLeaseExpiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await processing.claim(), null);
    assert.equal((await prisma.npdReceiptObligation.findUniqueOrThrow({ where: { id: receipt.id } })).issueState, "UNKNOWN");
    const completion = { receiptId: receipt.id, leaseToken: claim.leaseToken, officialReceiptId: "npdtest123", officialReceiptUrl: "https://lknpd.nalog.ru/api/v1/receipt/123456789012/npdtest123/print" };
    await assert.rejects(() => processing.complete({ ...completion, officialReceiptUrl: completion.officialReceiptUrl.replace("lknpd.nalog.ru", "attacker.example") }));
    await Promise.all([processing.complete(completion), processing.complete(completion)]);
    assert.equal((await prisma.npdReceiptObligation.findUniqueOrThrow({ where: { id: receipt.id } })).status, "DELIVERY_PENDING");
    assert.equal(await prisma.outboxEvent.count({ where: { aggregateId: receipt.id } }), 1, "One receipt delivery only");
    await processing.fail(receipt.id, claim.leaseToken, true);
    assert.equal((await prisma.npdReceiptObligation.findUniqueOrThrow({ where: { id: receipt.id } })).issueState, "COMPLETED");

    const refunded = await fixture(), refundClaim = await processing.claim();
    assert.equal(refundClaim?.receiptId, refunded.id);
    await processing.start(refunded.id, refundClaim!.leaseToken);
    await prisma.npdReceiptObligation.update({ where: { id: refunded.id }, data: { status: "REPLACEMENT_REQUIRED" } });
    await processing.complete({ ...completion, receiptId: refunded.id, leaseToken: refundClaim!.leaseToken, officialReceiptId: "npdrefund123", officialReceiptUrl: completion.officialReceiptUrl.replaceAll("npdtest123", "npdrefund123") });
    assert.equal((await prisma.npdReceiptObligation.findUniqueOrThrow({ where: { id: refunded.id } })).status, "REPLACEMENT_REQUIRED", "Late completion must preserve refund correction");
    assert.equal(await prisma.outboxEvent.count({ where: { aggregateId: refunded.id } }), 0, "Do not email an obsolete receipt");

    const canceled = await fixture(), canceledClaim = await processing.claim();
    assert.equal(canceledClaim?.receiptId, canceled.id);
    await prisma.npdReceiptObligation.update({ where: { id: canceled.id }, data: { status: "CANCELLATION_PENDING" } });
    await assert.rejects(() => processing.start(canceled.id, canceledClaim!.leaseToken));
    const broken = await fixture({ badBuyer: true });
    const healthy = await fixture();
    assert.equal(await processing.claim(), null);
    assert.equal((await prisma.npdReceiptObligation.findUniqueOrThrow({ where: { id: broken.id } })).issueErrorCode, "NPD_BUYER_MATERIAL_INVALID");
    const next = await processing.claim();
    assert.equal(next?.receiptId, healthy.id, "A damaged envelope must not starve the queue");
    await processing.fail(healthy.id, next!.leaseToken, false);
    assert.equal((await prisma.npdReceiptObligation.findUniqueOrThrow({ where: { id: healthy.id } })).issueState, "FAILED");
  } finally { await prisma.$disconnect(); }
});
