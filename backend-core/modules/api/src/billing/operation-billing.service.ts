import { Inject, Injectable } from "@nestjs/common";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import type { InternalOperationRoute, InternalPaidOperationAdmission, OperationEstimate, OperationEstimateCommand } from "@seo-platform/contracts";
import { AuthorizationService } from "../authorization/authorization.service.js";
import { DomainError } from "../common/domain-error.js";
import { assertUuid } from "../common/identifier.js";
import { uuidV7 } from "../common/uuid-v7.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import type { BillingOperationQuote, Prisma } from "../generated/prisma/client.js";
import { JobsClient, type InternalContext } from "../jobs/jobs.client.js";
import { BillingEntitlementService } from "./billing-entitlement.service.js";
import { BillingLedgerService } from "./billing-ledger.service.js";
import { spendablePrepaidMinor } from "./billing-balance-availability.js";
import { ceilDiv, defaultProviderPricingPolicy, priceOperation, providerCostBook, type OperationWorkload } from "./provider-pricing.js";

const QUOTE_TTL_MS = 5 * 60_000;
const CREATE_TTL_MS = 2 * 60_000;

@Injectable()
export class OperationBillingService {
  private nextCleanupAt = 0;
  public constructor(private readonly prisma: PrismaService, private readonly ledger: BillingLedgerService, private readonly jobs: JobsClient, private readonly authorization: AuthorizationService, private readonly entitlement: BillingEntitlementService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public async estimate(context: InternalContext, command: OperationEstimateCommand): Promise<OperationEstimate> {
    await this.entitlement.semanticCapacity(context.tenant.workspaceId);
    const route = await this.jobs.operationRoute(
      context,
      command.kind,
      command.kind === "KEYWORD_RESEARCH" ? command.command.source : undefined,
      command.kind === "FREQUENCY_COLLECTION"
        ? command.command.provider
        : undefined,
      command.kind === "FREQUENCY_COLLECTION"
        ? command.command.credentialId
        : command.kind === "AI_ANSWER_COLLECTION" ||
            command.kind === "CLUSTERING_RUN"
          ? command.command.credentialId
        : undefined
    );
    const quantity = command.kind === "KEYWORD_RESEARCH" ? command.command.source === "KEYS_SO" ? 1 : command.command.queries.length : command.command.items.length;
    const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);
    if (route.credentialMode === "BYOK_API_KEY") return { workspaceId: context.tenant.workspaceId, projectId: context.tenant.projectId!, id: null, kind: command.kind, provider: route.provider, credentialMode: route.credentialMode, currency: "RUB", maximumChargeMinor: 0, quantity, affordable: true, expiresAt: expiresAt.toISOString(), priceBookVersion: null };
    if (route.provider === "KEYS_SO" || !this.config.billing.providerUsage[route.provider].enabled) throw unavailable();
    this.assertClusteringCapacity(command.kind, quantity);
    const price = priceOperation(workload(command, route.provider));
    const policy = defaultProviderPricingPolicy;
    const available = await this.prisma.$transaction(async tx => {
      const balance = await this.ledger.balance(tx, context.tenant.workspaceId);
      const subscription = await tx.billingSubscription.findUnique({ where: { workspaceId: context.tenant.workspaceId }, select: { currentPeriodEnd: true } });
      return await spendablePrepaidMinor(tx, context.tenant.workspaceId, balance.prepaidMinor) + (subscription && subscription.currentPeriodEnd <= new Date() ? 0n : balance.includedCreditsMinor);
    });
    const publicQuote: OperationEstimate = { workspaceId: context.tenant.workspaceId, projectId: context.tenant.projectId!, id: null, kind: command.kind, provider: route.provider, credentialMode: "PLATFORM_PAID", currency: "RUB", maximumChargeMinor: price.customerChargeMinor, quantity, affordable: available >= BigInt(price.customerChargeMinor), expiresAt: expiresAt.toISOString(), priceBookVersion: price.priceBookVersion };
    if (!publicQuote.affordable) return publicQuote;
    const hash = Buffer.from(commandHash(context, command), "hex");
    const previous = await this.prisma.billingOperationQuote.findFirst({ where: { workspaceId: context.tenant.workspaceId, actorId: context.actorId, commandHash: hash, priceBookVersion: price.priceBookVersion, routeSnapshot: { equals: { ...route } }, status: "QUOTED", expiresAt: { gt: new Date(Date.now() + 15_000) } }, orderBy: { createdAt: "desc" } });
    if (previous) return { ...publicQuote, id: previous.id, expiresAt: previous.expiresAt.toISOString() };
    const quote = await this.prisma.billingOperationQuote.create({ data: {
      workspaceId: context.tenant.workspaceId, projectId: context.tenant.projectId!, actorId: context.actorId,
      kind: command.kind, provider: route.provider, routeSnapshot: { ...route }, commandHash: hash,
      quantity, priceBookVersion: price.priceBookVersion, unitCostMicro: providerCostBook.unitCostMicro[price.product],
      priceDenominatorBps: 10_000 - policy.targetMarginBps - policy.paymentFeeBps - policy.taxReserveBps - policy.contingencyBps,
      maximumProviderUnitsMilli: BigInt(price.providerUnitsMilli), maximumChargeMinor: BigInt(price.customerChargeMinor), expiresAt
    } });
    return { ...publicQuote, id: quote.id };
  }

  public async admit(context: InternalContext, command: OperationEstimateCommand, commandKey: string, quoteId: unknown): Promise<InternalPaidOperationAdmission | undefined> {
    if (quoteId === undefined) return undefined;
    const id = assertUuid(String(quoteId), "operationEstimateId");
    const hash = commandHash(context, command);
    return this.prisma.$transaction(async tx => {
      await lockWorkspace(tx, context.tenant.workspaceId);
      const previous = await tx.billingOperationQuote.findUnique({ where: { workspaceId_kind_commandKey: { workspaceId: context.tenant.workspaceId, kind: command.kind, commandKey } } });
      if (previous) { assertScope(previous, context, hash); return admission(previous); }
      await tx.$queryRaw`SELECT id FROM billing_operation_quotes WHERE id = ${id}::uuid FOR UPDATE`;
      const quote = await tx.billingOperationQuote.findUnique({ where: { id } });
      if (!quote) throw stale();
      assertScope(quote, context, hash);
      if (quote.status !== "QUOTED" || quote.expiresAt <= new Date()) throw stale();
      if (!this.config.billing.providerUsage[quote.provider as "XMLSTOCK" | "ARSENKIN"].enabled) throw unavailable();
      this.assertClusteringCapacity(quote.kind, quote.quantity);
      const subscription = await tx.billingSubscription.findUnique({ where: { workspaceId: quote.workspaceId }, select: { currentPeriodEnd: true } });
      const balance = await this.ledger.balance(tx, quote.workspaceId);
      const includedMinor = subscription && subscription.currentPeriodEnd <= new Date() ? 0n : min(positive(balance.includedCreditsMinor), quote.maximumChargeMinor);
      const prepaidMinor = quote.maximumChargeMinor - includedMinor;
      if (await spendablePrepaidMinor(tx, quote.workspaceId, balance.prepaidMinor) < prepaidMinor) throw new DomainError({ statusCode: 409, code: "INSUFFICIENT_BALANCE", message: "Недостаточно средств. Пополните баланс или подключите свой API-ключ." });
      const now = new Date();
      await this.ledger.post(tx, { type: "RESERVATION", businessReference: `operation:${quote.id}:reserve`, description: "Резерв на SEO-операцию", occurredAt: now, createdBy: quote.actorId, metadata: { quoteId: quote.id, kind: quote.kind, priceBookVersion: quote.priceBookVersion }, entries: [
        ...(includedMinor > 0n ? [{ workspaceId: quote.workspaceId, accountType: "PROMOTIONAL_LIABILITY" as const, direction: "DEBIT" as const, amountMinor: includedMinor }] : []),
        ...(prepaidMinor > 0n ? [{ workspaceId: quote.workspaceId, accountType: "CUSTOMER_PREPAID_LIABILITY" as const, direction: "DEBIT" as const, amountMinor: prepaidMinor }] : []),
        { workspaceId: quote.workspaceId, accountType: "RESERVATION", direction: "CREDIT", amountMinor: quote.maximumChargeMinor }
      ] });
      const reserved = await tx.billingOperationQuote.update({ where: { id }, data: { status: "RESERVED", commandKey, jobId: uuidV7(), includedMinor, prepaidMinor, includedPeriodEnd: subscription?.currentPeriodEnd ?? null, reservedAt: now, createBefore: new Date(now.getTime() + CREATE_TTL_MS) } });
      return admission(reserved);
    });
  }

  public async authorize(quoteId: string, ticketId: string, ticketToken: string): Promise<void> {
    const quote = await this.prisma.billingOperationQuote.findUnique({ where: { id: quoteId } });
    if (!quote?.jobId || quote.status !== "RESERVED" || !this.config.billing.providerUsage[quote.provider as "XMLSTOCK" | "ARSENKIN"].enabled) throw stale();
    const tenant = await this.authorization.forProject(quote.actorId, quote.projectId, "collector.run");
    if (tenant.workspaceId !== quote.workspaceId || tenant.workspaceStatus !== "ACTIVE" || tenant.projectStatus !== "ACTIVE") throw stale();
    const user = await this.prisma.user.findUnique({ where: { id: quote.actorId }, select: { status: true } });
    if (user?.status !== "ACTIVE") throw stale();
    await this.entitlement.semanticCapacity(quote.workspaceId);
    const proof = await this.jobs.paidOperationProof({ tenant, actorId: quote.actorId, requestId: `operation-proof-${ticketId}` }, { quoteId, jobId: quote.jobId, commandHash: Buffer.from(quote.commandHash).toString("hex"), ticketId, ticketToken });
    if (!proof.permitted || Date.parse(proof.leaseExpiresAt) <= Date.now() + 1_000 || BigInt(proof.unitsMilli) < 1n || BigInt(proof.unitsMilli) > quote.maximumProviderUnitsMilli) throw stale();
    await this.jobs.authorizePaidOperationTicket({ tenant, actorId: quote.actorId, requestId: `operation-authorize-${ticketId}` }, { quoteId, jobId: quote.jobId, commandHash: Buffer.from(quote.commandHash).toString("hex"), ticketId, ticketToken });
    // Execution must still atomically mark this exact ticket STARTED under its
    // live job lease after receiving this response and before provider I/O.
  }

  private assertClusteringCapacity(kind: string, quantity: number): void {
    const limit = this.config.billing.providerUsage.ARSENKIN.clusteringKeywordLimit ?? 30_000;
    if (kind === "CLUSTERING_RUN" && quantity > limit) throw new DomainError({ statusCode: 422, code: "PROVIDER_SCOPE_LIMIT_EXCEEDED", message: `Системный источник поддерживает кластеризацию до ${limit} фраз за запуск. Выберите меньший охват или подключите свой аккаунт Arsenkin с подходящим тарифом.` });
  }

  public async reconcile(batchSize = 25): Promise<void> {
    if (Date.now() >= this.nextCleanupAt) {
      const expired = await this.prisma.billingOperationQuote.findMany({ where: { status: "QUOTED", expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } }, select: { id: true }, orderBy: { expiresAt: "asc" }, take: 500 });
      await this.prisma.billingOperationQuote.deleteMany({ where: { id: { in: expired.map(row => row.id) }, status: "QUOTED" } });
      this.nextCleanupAt = Date.now() + 3_600_000;
    }
    const rows = await this.prisma.billingOperationQuote.findMany({ where: { status: { in: ["RESERVED", "REVIEW"] }, nextCheckAt: { lte: new Date() } }, orderBy: [{ nextCheckAt: "asc" }, { id: "asc" }], take: Math.min(100, Math.max(1, batchSize)) });
    let failed = false;
    for (const row of rows) {
      const claimed = await this.prisma.billingOperationQuote.updateMany({ where: { id: row.id, status: { in: ["RESERVED", "REVIEW"] }, nextCheckAt: { lte: new Date() } }, data: { nextCheckAt: new Date(Date.now() + 60_000) } });
      if (!claimed.count) continue;
      try { await this.reconcileOne(row); } catch { failed = true; }
    }
    if (failed) throw new Error("Provider usage reconciliation requires retry");
  }

  public async reconcileOne(row: BillingOperationQuote): Promise<void> {
    if (!row.jobId) return;
    const context: InternalContext = { tenant: { workspaceId: row.workspaceId, projectId: row.projectId, workspaceStatus: "ACTIVE", projectStatus: "ACTIVE", roleCode: "OWNER" }, actorId: row.actorId, requestId: `operation-reconcile-${row.id}` };
    const usage = await this.jobs.paidOperationUsage(context, { quoteId: row.id, jobId: row.jobId, commandHash: Buffer.from(row.commandHash).toString("hex") });
    if (!usage.exists && (!row.createBefore || Date.now() <= row.createBefore.getTime() + 120_000)) return;
    await this.prisma.$transaction(async tx => {
      await lockWorkspace(tx, row.workspaceId);
      await tx.$queryRaw`SELECT id FROM billing_operation_quotes WHERE id = ${row.id}::uuid FOR UPDATE`;
      const quote = await tx.billingOperationQuote.findUniqueOrThrow({ where: { id: row.id } });
      if (quote.status === "SETTLED") return;
      const accepted = BigInt(usage.acceptedProviderUnitsMilli);
      const unresolved = BigInt(usage.unresolvedProviderUnitsMilli);
      if (accepted < quote.acceptedProviderUnitsMilli || accepted + unresolved > quote.maximumProviderUnitsMilli || (!usage.exists && (accepted || unresolved))) throw new Error("Invalid paid operation metering projection");
      const charge = ceilDiv(quote.unitCostMicro * accepted, 1_000n * BigInt(quote.priceDenominatorBps));
      if (charge > quote.maximumChargeMinor) throw new Error("Paid operation exceeded its confirmed amount");
      const increment = charge - quote.capturedMinor;
      const now = new Date();
      if (increment > 0n) await this.ledger.post(tx, { type: "CAPTURE", businessReference: `operation:${quote.id}:capture:${accepted}`, description: "Принятые провайдером SEO-запросы", occurredAt: now, createdBy: quote.actorId, metadata: { quoteId: quote.id, kind: quote.kind, provider: quote.provider, providerUnitsMilli: accepted.toString(), priceBookVersion: quote.priceBookVersion }, entries: [
        { workspaceId: quote.workspaceId, accountType: "RESERVATION", direction: "DEBIT", amountMinor: increment },
        { accountType: "PLATFORM_REVENUE", direction: "CREDIT", amountMinor: increment }
      ] });
      const terminal = (!usage.exists || usage.terminal) && unresolved === 0n;
      const remainder = quote.maximumChargeMinor - charge;
      if (terminal && remainder > 0n) {
        const unusedIncluded = positive(quote.includedMinor - charge);
        const unusedPrepaid = remainder - unusedIncluded;
        const subscription = await tx.billingSubscription.findUnique({ where: { workspaceId: quote.workspaceId }, select: { currentPeriodEnd: true } });
        const expiredIncluded = quote.includedPeriodEnd !== null && (quote.includedPeriodEnd <= now || subscription?.currentPeriodEnd.getTime() !== quote.includedPeriodEnd.getTime());
        await this.ledger.post(tx, { type: "RELEASE", businessReference: `operation:${quote.id}:release`, description: "Освобождение неиспользованного резерва SEO-операции", occurredAt: now, createdBy: quote.actorId, metadata: { quoteId: quote.id, expiredIncluded }, entries: [
          { workspaceId: quote.workspaceId, accountType: "RESERVATION", direction: "DEBIT", amountMinor: remainder },
          ...(unusedIncluded > 0n ? [{ ...(expiredIncluded ? {} : { workspaceId: quote.workspaceId }), accountType: expiredIncluded ? "PROMOTIONAL_EXPENSE" as const : "PROMOTIONAL_LIABILITY" as const, direction: "CREDIT" as const, amountMinor: unusedIncluded }] : []),
          ...(unusedPrepaid > 0n ? [{ workspaceId: quote.workspaceId, accountType: "CUSTOMER_PREPAID_LIABILITY" as const, direction: "CREDIT" as const, amountMinor: unusedPrepaid }] : [])
        ] });
      }
      await tx.billingOperationQuote.update({ where: { id: quote.id }, data: { capturedMinor: charge, acceptedProviderUnitsMilli: accepted, ...(terminal ? { status: "SETTLED", releasedMinor: remainder, settledAt: now } : usage.terminal && unresolved > 0n ? { status: "REVIEW" } : {}) } });
    });
  }
}

export function operationCommandHash(workspaceId: string, projectId: string, actorId: string, command: OperationEstimateCommand): string { return canonicalJsonSha256("paid-operation-command@1", { workspaceId, projectId, actorId, ...command }); }
function commandHash(context: InternalContext, command: OperationEstimateCommand): string { return operationCommandHash(context.tenant.workspaceId, context.tenant.projectId!, context.actorId, command); }
function assertScope(row: BillingOperationQuote, context: InternalContext, hash: string) { if (row.workspaceId !== context.tenant.workspaceId || row.projectId !== context.tenant.projectId || row.actorId !== context.actorId || Buffer.from(row.commandHash).toString("hex") !== hash) throw stale(); }
function admission(row: BillingOperationQuote): InternalPaidOperationAdmission {
  if (!row.jobId || !row.createBefore) throw stale();
  const route = row.routeSnapshot as unknown as InternalOperationRoute;
  return { quoteId: row.id, jobId: row.jobId, provider: row.provider as "XMLSTOCK" | "ARSENKIN", credentialId: route.credentialId, bindingId: route.bindingId, bindingVersion: route.bindingVersion, routeId: route.routeId, commandHash: Buffer.from(row.commandHash).toString("hex"), maximumProviderUnitsMilli: row.maximumProviderUnitsMilli.toString(), createBefore: row.createBefore.toISOString() };
}
function workload(command: OperationEstimateCommand, provider: "XMLSTOCK" | "ARSENKIN"): OperationWorkload {
  switch (command.kind) {
    case "FREQUENCY_COLLECTION": return { provider, operation: "FREQUENCY", keywordCount: command.command.items.length, frequencyVariantCount: command.command.types.length };
    case "AI_ANSWER_COLLECTION": return { provider, operation: "AI_ANSWER", keywordCount: command.command.items.length };
    case "CLUSTERING_RUN": return { provider, operation: "CLUSTERING", keywordCount: command.command.items.length, frequencyVariantCount: command.command.frequencyTypes.length };
    case "KEYWORD_RESEARCH": if (command.command.source === "KEYS_SO") throw unavailable(); return { provider, operation: "WORDSTAT_EXPANSION", keywordCount: command.command.queries.length };
  }
}
async function lockWorkspace(tx: Prisma.TransactionClient, id: string) { await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${id}::uuid FOR UPDATE`; }
function positive(n: bigint) { return n > 0n ? n : 0n; }
function min(a: bigint, b: bigint) { return a < b ? a : b; }
function stale() { return new DomainError({ statusCode: 409, code: "ESTIMATE_STALE", message: "Параметры или расчёт изменились. Подтвердите актуальную стоимость операции." }); }
function unavailable() { return new DomainError({ statusCode: 503, code: "FEATURE_NOT_AVAILABLE", message: "Системный провайдер временно недоступен. Можно использовать свой API-ключ." }); }
