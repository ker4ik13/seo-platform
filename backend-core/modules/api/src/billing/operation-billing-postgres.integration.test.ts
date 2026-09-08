import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import type { InternalPaidOperationUsage, OperationEstimateCommand } from "@seo-platform/contracts";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { loadAppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import { BillingLedgerService } from "./billing-ledger.service.js";
import { OperationBillingService } from "./operation-billing.service.js";
import { BillingUsageService } from "./billing-usage.service.js";
import { PlatformUsageReviewController } from "../admin/platform-usage-review.controller.js";
import { AuditService } from "../audit/audit.service.js";
import type { InternalContext } from "../jobs/jobs.client.js";

const databaseUrl = process.env.PLATFORM_API_BILLING_TEST_DATABASE_URL;
test("PostgreSQL operation escrow prevents overdraft, binds commands, settles monotonically and preserves unknown spend", { skip: !databaseUrl, timeout: 30_000 }, async () => {
  assert.ok(databaseUrl);
  const url = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port && url.port !== "5432");
  const config = loadAppConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl, AUTH_DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64url"), PLATFORM_XMLSTOCK_ENABLED: "true", PLATFORM_XMLSTOCK_RANK_KEYWORD_PRICE_MINOR: "1", PLATFORM_XMLSTOCK_DAILY_SPEND_LIMIT_MINOR: "100000", PLATFORM_XMLSTOCK_MONTHLY_SPEND_LIMIT_MINOR: "1000000" });
  const prisma = new PrismaService(config);
  const ledger = new BillingLedgerService();
  let accepted = "0"; let unresolved = "0"; let terminal = false; let grants = 0;
  const jobs = {
    operationRoute: async (context: InternalContext) => ({ workspaceId: context.tenant.workspaceId, projectId: context.tenant.projectId, actorId: context.actorId, provider: "XMLSTOCK", credentialMode: "PLATFORM_PAID", credentialId: randomUUID(), routeId: randomUUID(), bindingId: randomUUID(), bindingVersion: 1 }),
    paidOperationUsage: async (context: InternalContext, scope: { quoteId: string; jobId: string; commandHash: string }): Promise<InternalPaidOperationUsage> => ({ ...scope, workspaceId: context.tenant.workspaceId, projectId: context.tenant.projectId!, actorId: context.actorId, exists: true, terminal, acceptedProviderUnitsMilli: accepted, unresolvedProviderUnitsMilli: unresolved, lastUpdatedAt: new Date().toISOString() }),
    paidOperationProof: async (_context: unknown, scope: object) => ({ ...scope, permitted: true, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), unitsMilli: "1000" }),
    authorizePaidOperationTicket: async () => { grants++; }
  };
  const service = new OperationBillingService(prisma, ledger, jobs as never, new AuthorizationService(prisma), { semanticCapacity: async () => ({}) } as never, config);
  try {
    const email = `paid-test-${randomUUID()}@example.invalid`;
    const user = await prisma.user.create({ data: { emailNormalized: email, emailDisplay: email, displayName: "Paid operation test", status: "ACTIVE", emailVerifiedAt: new Date() } });
    const workspace = await prisma.workspace.create({ data: { name: "Paid test", slug: `paid-${randomUUID()}`, ownerUserId: user.id } });
    await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, roleCode: "OWNER", status: "ACTIVE" } });
    const project = await prisma.project.create({ data: { workspaceId: workspace.id, name: "Paid test", slug: "paid", domain: "example.invalid", status: "ACTIVE", createdBy: user.id, ownerUserId: user.id } });
    const context: InternalContext = { tenant: { workspaceId: workspace.id, projectId: project.id, workspaceStatus: "ACTIVE", projectStatus: "ACTIVE", roleCode: "OWNER" }, actorId: user.id, requestId: `test-${randomUUID()}` };
    await prisma.$transaction(tx => ledger.post(tx, { type: "TOP_UP", businessReference: `test-funding:${workspace.id}`, description: "Disposable test funding", occurredAt: new Date(), metadata: {}, entries: [{ workspaceId: workspace.id, accountType: "CUSTOMER_PREPAID_LIABILITY", direction: "CREDIT", amountMinor: 100n }, { accountType: "PAYMENT_CLEARING", direction: "DEBIT", amountMinor: 100n }] }));
    const command: OperationEstimateCommand = { kind: "FREQUENCY_COLLECTION", command: { items: Array.from({ length: 3 }, () => ({ id: randomUUID(), version: 1 })), types: ["BASE", "EXACT", "FIXED"], regionCode: "213", device: "ALL" } };
    const quote = await service.estimate(context, command); assert.ok(quote.id); assert.equal(quote.maximumChargeMinor, 61);
    const second = await service.estimate(context, command); assert.ok(second.id);
    const key = randomUUID();
    const [first, same] = await Promise.all([service.admit(context, command, key, quote.id), service.admit(context, command, key, quote.id)]);
    assert.ok(first && same); assert.equal(first.jobId, same.jobId);
    assert.equal(await prisma.billingLedgerTransaction.count({ where: { businessReference: `operation:${quote.id}:reserve` } }), 1);
    await assert.rejects(() => service.admit(context, command, randomUUID(), second.id), { code: "INSUFFICIENT_BALANCE" });
    await assert.rejects(() => service.admit(context, { ...command, command: { ...command.command, types: ["BASE"] } }, randomUUID(), second.id), { code: "ESTIMATE_STALE" });
    const balance = () => prisma.$transaction(tx => ledger.balance(tx, workspace.id));
    assert.equal((await balance()).prepaidMinor, 39n);
    await service.authorize(quote.id, randomUUID(), randomUUID()); assert.equal(grants, 1);
    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });
    await assert.rejects(() => service.authorize(quote.id!, randomUUID(), randomUUID())); assert.equal(grants, 1);
    await prisma.user.update({ where: { id: user.id }, data: { status: "ACTIVE" } });

    const stored = () => prisma.billingOperationQuote.findUniqueOrThrow({ where: { id: quote.id! } });
    accepted = "2000"; unresolved = "1000";
    await Promise.all([service.reconcileOne(await stored()), service.reconcileOne(await stored())]);
    assert.equal((await stored()).capturedMinor, 14n);
    terminal = true;
    await service.reconcileOne(await stored());
    assert.equal((await stored()).status, "REVIEW");
    assert.equal((await balance()).prepaidMinor, 39n, "Cancellation cannot release an unresolved external request");
    accepted = "3000"; unresolved = "0";
    await Promise.all([service.reconcileOne(await stored()), service.reconcileOne(await stored())]);
    assert.equal((await stored()).status, "SETTLED");
    assert.equal((await stored()).capturedMinor, 21n);
    assert.equal((await balance()).prepaidMinor, 79n, "Only accepted units are charged; repeated settlement is inert");
    await assert.rejects(() => prisma.billingOperationQuote.update({ where: { id: quote.id! }, data: { unitCostMicro: 1n } }));
    await assert.rejects(() => prisma.billingOperationQuote.delete({ where: { id: quote.id! } }));

    // Time-shifted valid fixtures model a connector crash without bypassing SQL guards.
    const usage = new BillingUsageService(ledger), old = new Date(Date.now() - 3_600_000);
    async function oldReservation(amount: bigint, pinned: boolean) {
      return prisma.$transaction(async tx => {
        const id = randomUUID(), reference = `rank-test:${id}`;
        const transactionId = await ledger.post(tx, { type: "RESERVATION", businessReference: reference, description: "Interrupted provider request fixture", occurredAt: old, metadata: {}, entries: [
          { workspaceId: workspace.id, accountType: "CUSTOMER_PREPAID_LIABILITY", direction: "DEBIT", amountMinor: amount },
          { workspaceId: workspace.id, accountType: "RESERVATION", direction: "CREDIT", amountMinor: amount }
        ] });
        return tx.billingUsageReservation.create({ data: { id, workspaceId: workspace.id, projectId: project.id, actorId: user.id, jobId: randomUUID(), jobItemId: randomUUID(), executionAttempt: 1, provider: "XMLSTOCK", operation: "POSITIONS", quantity: 1, unitPriceMinor: amount, amountMinor: amount, includedAmountMinor: 0n, prepaidAmountMinor: amount, businessReference: reference, requestHash: randomBytes(32), reservationTransactionId: transactionId, reservedAt: old, expiresAt: new Date(old.getTime() + 60_000), ...(pinned ? { providerStartedAt: old } : {}), createdAt: old } });
      });
    }
    const pinned = await oldReservation(20n, true), unstarted = await oldReservation(10n, false);
    await prisma.$transaction(tx => usage.releaseExpired(tx, 100));
    assert.equal((await prisma.billingUsageReservation.findUniqueOrThrow({ where: { id: unstarted.id } })).status, "RELEASED");
    assert.equal((await prisma.billingUsageReservation.findUniqueOrThrow({ where: { id: pinned.id } })).status, "RESERVED");
    assert.equal((await balance()).prepaidMinor, 59n);
    let finishedAt = new Date().toISOString();
    const review = new PlatformUsageReviewController(prisma, { getRankJob: async (scope: InternalContext, id: string) => { assert.equal(scope.tenant.workspaceId, workspace.id); assert.equal(scope.tenant.projectId, project.id); return { id, finishedAt, provider: "XMLSTOCK" }; } } as never, service, new AuditService(prisma), usage);
    const request = { id: `rank-review-${randomUUID()}`, headers: { "idempotency-key": `review:${randomUUID()}` } };
    const release = { resolution: "RELEASE", reason: "Provider confirmed no charge", confirmed: true };
    await assert.rejects(() => review.resolveRank(pinned.id, release, request as never, { userId: user.id } as never), /Wait for the operation/u);
    finishedAt = old.toISOString();
    await Promise.all([review.resolveRank(pinned.id, release, request as never, { userId: user.id } as never), review.resolveRank(pinned.id, release, request as never, { userId: user.id } as never)]);
    assert.equal((await balance()).prepaidMinor, 79n, "An administrator releases the old pin exactly once");
    await assert.rejects(() => review.resolveRank(pinned.id, { ...release, resolution: "CHARGE", providerReference: "confirmed-123" }, request as never, { userId: user.id } as never), /already final/u);
    const charged = await oldReservation(15n, true);
    await assert.rejects(() => review.resolveRank(charged.id, { ...release, resolution: "CHARGE" }, request as never, { userId: user.id } as never), /provider operation reference/u);
    const charge = { ...release, resolution: "CHARGE", providerReference: "confirmed-456" };
    await Promise.all([review.resolveRank(charged.id, charge, request as never, { userId: user.id } as never), review.resolveRank(charged.id, charge, request as never, { userId: user.id } as never)]);
    assert.equal((await balance()).prepaidMinor, 64n);
    assert.equal((await prisma.billingUsageReservation.findUniqueOrThrow({ where: { id: charged.id } })).status, "CAPTURED");
    assert.equal(await prisma.auditEvent.count({ where: { resourceId: charged.id, action: "billing.rank_usage_review.resolved" } }), 1);
    await assert.rejects(() => prisma.billingUsageReservation.update({ where: { id: charged.id }, data: { reviewDecision: { resolution: "RELEASE" } } }));
    const live = await prisma.$transaction(tx => usage.reserve(tx, { workspaceId: workspace.id, projectId: project.id, actorId: user.id, jobId: randomUUID(), jobItemId: randomUUID(), executionAttempt: 1, provider: "XMLSTOCK", operation: "POSITIONS", quantity: 1, unitPriceMinor: 3n, providerDailySpendLimitMinor: 100_000n, providerMonthlySpendLimitMinor: 1_000_000n, businessReference: `live-rank-test:${randomUUID()}` }));
    await prisma.$transaction(tx => usage.hold(tx, live.id));
    assert.ok((await prisma.billingUsageReservation.findUniqueOrThrow({ where: { id: live.id } })).providerStartedAt);
    await assert.rejects(() => prisma.billingUsageReservation.update({ where: { id: live.id }, data: { providerStartedAt: null } }));
    await prisma.$transaction(tx => usage.release(tx, live.id));
  } finally { await prisma.$disconnect(); }
});
