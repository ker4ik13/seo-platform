import { Injectable } from "@nestjs/common";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import type { AdminRefundRequest, BillingRefundEligibility, BillingRefundRequestSummary, CreateBillingRefundInput } from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import { DomainError, isUniqueConstraintError } from "../common/domain-error.js";
import { PrismaService } from "../database/prisma.service.js";
import type { BillingRefundRequest, Prisma } from "../generated/prisma/client.js";
import type { RequestContext } from "../identity/identity.types.js";
import { BillingLedgerService } from "./billing-ledger.service.js";
import { BillingService } from "./billing.service.js";
import { addBillingPeriod, subscriptionValueAt } from "./subscription-value.js";
import { spendablePrepaidMinor } from "./billing-balance-availability.js";

const OPEN = ["REQUESTED", "APPROVED", "PROCESSING", "MANUAL_REQUIRED"];
type RequestWithPayment = Prisma.BillingRefundRequestGetPayload<{ include: { payment: { include: { order: true } }; refund: true } }>;
const INCLUDE = { payment: { include: { order: true } }, refund: true } as const;

@Injectable()
export class RefundRequestService {
  public constructor(private readonly prisma: PrismaService, private readonly ledger: BillingLedgerService, private readonly billing: BillingService, private readonly audit: AuditService) {}

  public async eligibility(workspaceId: string, paymentId: string): Promise<BillingRefundEligibility> {
    return this.prisma.$transaction(tx => this.eligible(tx, workspaceId, paymentId));
  }

  public async list(workspaceId: string): Promise<readonly BillingRefundRequestSummary[]> {
    const rows = await this.prisma.billingRefundRequest.findMany({ where: { workspaceId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, include: INCLUDE });
    return rows.map(summary);
  }

  public async create(workspaceId: string, paymentId: string, actorId: string, idempotencyKey: string, input: CreateBillingRefundInput, context: RequestContext): Promise<BillingRefundRequestSummary> {
    const hash = Buffer.from(canonicalJsonSha256("billing-refund-request@1", { workspaceId, paymentId, actorId, ...input }), "hex");
    try {
      const result = await this.prisma.$transaction(async tx => {
        await workspaceLock(tx, workspaceId);
        const replay = await tx.billingRefundRequest.findUnique({ where: { workspaceId_requestIdempotencyKey: { workspaceId, requestIdempotencyKey: idempotencyKey } }, include: INCLUDE });
        if (replay) { if (!Buffer.from(replay.requestHash).equals(hash)) throw conflict("Этот ключ уже использован для другой заявки."); return replay; }
        const eligible = await this.eligible(tx, workspaceId, paymentId);
        if (input.amountMinor < 1 || input.amountMinor > eligible.maximumAmountMinor) throw conflict("Запросить можно только доступный неиспользованный остаток.", { maximumAmountMinor: eligible.maximumAmountMinor });
        const row = await tx.billingRefundRequest.create({ data: { workspaceId, paymentId, requestedBy: actorId, requestedAmountMinor: BigInt(input.amountMinor), reason: input.reason, requestIdempotencyKey: idempotencyKey, requestHash: hash }, include: INCLUDE });
        await this.audit.record({ actorId, workspaceId, action: "billing.refund_request.created", resourceType: "billing_refund_request", resourceId: row.id, requestId: context.requestId }, tx);
        return row;
      });
      return summary(result);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw conflict("По этому платежу уже рассматривается заявка на возврат.");
      throw error;
    }
  }

  public async adminList(): Promise<readonly AdminRefundRequest[]> {
    // An old unanswered request must not disappear behind recent completed
    // refunds. Pending decisions are shown first, oldest first within a group.
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM billing_refund_requests
      ORDER BY CASE WHEN status = 'REQUESTED' THEN 0
        WHEN status IN ('APPROVED', 'PROCESSING', 'MANUAL_REQUIRED') THEN 1 ELSE 2 END,
        CASE WHEN status IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'MANUAL_REQUIRED') THEN created_at END ASC,
        created_at DESC, id DESC LIMIT 100
    `;
    const selected = await this.prisma.billingRefundRequest.findMany({ where: { id: { in: ids.map(row => row.id) } }, include: INCLUDE });
    const byId = new Map(selected.map(row => [row.id, row]));
    const rows = ids.flatMap(({ id }) => { const row = byId.get(id); return row ? [row] : []; });
    const workspaces = await this.prisma.workspace.findMany({ where: { id: { in: [...new Set(rows.map(row => row.workspaceId))] } }, select: { id: true, name: true } });
    const names = new Map(workspaces.map(row => [row.id, row.name]));
    const results: AdminRefundRequest[] = [];
    for (let offset = 0; offset < rows.length; offset += 4) {
      const batch = await Promise.all(rows.slice(offset, offset + 4).map(async row => {
        const eligible = row.status === "REQUESTED" ? await this.prisma.$transaction(tx => this.eligible(tx, row.workspaceId, row.paymentId, row.id)) : undefined;
        return { ...summary(row), workspaceName: names.get(row.workspaceId) ?? "—", description: row.payment.order.serviceDescriptionSnapshot, maximumAmountMinor: eligible?.maximumAmountMinor ?? Number(row.approvedAmountMinor ?? 0n) };
      }));
      results.push(...batch);
    }
    return results;
  }

  public async decide(id: string, version: number, actorId: string, decision: "APPROVE" | "REJECT", reason: string, requestedApprovalMinor: number | undefined, context: RequestContext): Promise<BillingRefundRequestSummary> {
    const initial = await this.prisma.billingRefundRequest.findUnique({ where: { id } }); if (!initial) throw notFound();
    const row = await this.prisma.$transaction(async tx => {
      await workspaceLock(tx, initial.workspaceId);
      await tx.$queryRaw`SELECT id FROM billing_refund_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.billingRefundRequest.findUniqueOrThrow({ where: { id }, include: INCLUDE });
      if (current.status !== "REQUESTED" || current.version !== version) throw conflict("Заявка уже изменена. Обновите список.");
      const now = new Date();
      if (decision === "REJECT") {
        const rejected = await tx.billingRefundRequest.update({ where: { id }, data: { status: "REJECTED", decisionReason: reason, decidedBy: actorId, decidedAt: now, version: { increment: 1 } }, include: INCLUDE });
        await this.audit.record({ actorId, workspaceId: current.workspaceId, action: "billing.refund_request.rejected", resourceType: "billing_refund_request", resourceId: id, requestId: context.requestId }, tx);
        return rejected;
      }
      const eligible = await this.eligible(tx, current.workspaceId, current.paymentId, current.id);
      const maximum = min(current.requestedAmountMinor, BigInt(eligible.maximumAmountMinor));
      const amount = requestedApprovalMinor === undefined ? maximum : BigInt(requestedApprovalMinor);
      if (amount < 1n || amount > maximum) throw conflict("Доступный остаток изменился. Обновите расчёт.", { maximumAmountMinor: Number(maximum) });
      let heldPrepaidMinor = 0n;
      let adjustment: Prisma.InputJsonValue | undefined;
      if (current.payment.order.kind === "TOP_UP") {
        heldPrepaidMinor = amount;
        await this.ledger.post(tx, { type: "RESERVATION", businessReference: `refund-request:${id}:reserve`, description: "Сумма одобренного возврата", occurredAt: now, createdBy: actorId, metadata: { requestId: id, paymentId: current.paymentId }, entries: [
          { workspaceId: current.workspaceId, accountType: "CUSTOMER_PREPAID_LIABILITY", direction: "DEBIT", amountMinor: amount },
          { workspaceId: current.workspaceId, accountType: "RESERVATION", direction: "CREDIT", amountMinor: amount }
        ] });
      } else {
        const subscription = await tx.billingSubscription.findUniqueOrThrow({ where: { workspaceId: current.workspaceId } });
        const value = await subscriptionValueAt(tx, subscription, now);
        const remainingMs = Math.max(0, subscription.currentPeriodEnd.getTime() - now.getTime());
        if (value.remainingMinor < amount || remainingMs === 0) throw conflict("Оплаченный остаток подписки изменился.");
        const retained = value.remainingMinor - amount;
        const nextEnd = new Date(Math.max(subscription.currentPeriodStart.getTime() + 1, now.getTime() + Number(BigInt(remainingMs) * retained / value.remainingMinor)));
        adjustment = { planVersionId: subscription.planVersionId, durationMs: remainingMs, valueMinor: value.remainingMinor.toString(), refundedValueMinor: amount.toString(), refundableFrom: value.refundableFrom?.toISOString() ?? current.payment.succeededAt!.toISOString() };
        await tx.billingSubscription.update({ where: { id: subscription.id }, data: { serviceValueMinor: retained, serviceValueAt: now, refundableFrom: value.refundableFrom, currentPeriodEnd: nextEnd, cancelAtPeriodEnd: true, status: retained > 0n ? "CANCELLING" : "CANCELLED", version: { increment: 1 } } });
        if (retained === 0n) await tx.workspace.updateMany({ where: { id: current.workspaceId, status: "ACTIVE" }, data: { status: "READ_ONLY", version: { increment: 1 } } });
      }
      const approved = await tx.billingRefundRequest.update({ where: { id }, data: { status: current.payment.provider === "YOOKASSA" ? "APPROVED" : "MANUAL_REQUIRED", approvedAmountMinor: amount, heldPrepaidMinor, ...(adjustment ? { subscriptionAdjustment: adjustment } : {}), decisionReason: reason, decidedBy: actorId, decidedAt: now, version: { increment: 1 } }, include: INCLUDE });
      await this.audit.record({ actorId, workspaceId: current.workspaceId, action: "billing.refund_request.approved", resourceType: "billing_refund_request", resourceId: id, requestId: context.requestId }, tx);
      return approved;
    });
    // The durable approved decision is the source of truth. Provider I/O is
    // performed by reconciliation, outside the HTTP approval transaction.
    return summary(row);
  }

  public async reconcile(batchSize = 25): Promise<void> {
    const rows = await this.prisma.billingRefundRequest.findMany({ where: { status: { in: ["APPROVED", "PROCESSING"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: Math.min(100, batchSize), include: INCLUDE });
    let failed = false;
    for (const row of rows) {
      try {
        await this.billing.createRefund(row.workspaceId, row.paymentId, row.decidedBy!, `refund-request:${row.id}`, { amountMinor: Number(row.approvedAmountMinor), reason: row.decisionReason ?? row.reason }, { requestId: `refund-request-${row.id}` }, row.id);
      } catch { failed = true; }
      const latest = await this.prisma.billingRefundRequest.findUniqueOrThrow({ where: { id: row.id }, include: INCLUDE });
      if (latest.refund?.status === "SUCCEEDED") await this.finish(latest, "SUCCEEDED");
      else if (latest.refund && ["CANCELED", "FAILED_FINAL"].includes(latest.refund.status)) await this.finish(latest, "FAILED");
    }
    if (failed) throw new Error("Refund processing requires retry or review");
  }

  public async confirmManual(id: string, version: number, actorId: string, reference: string, context: RequestContext): Promise<BillingRefundRequestSummary> {
    const row = await this.prisma.billingRefundRequest.findUnique({ where: { id }, include: INCLUDE }); if (!row) throw notFound();
    return this.prisma.$transaction(async tx => {
      await workspaceLock(tx, row.workspaceId);
      await tx.$queryRaw`SELECT id FROM billing_refund_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.billingRefundRequest.findUniqueOrThrow({ where: { id }, include: INCLUDE });
      if (current.status === "SUCCEEDED" && current.manualReference === reference) return summary(current);
      if (current.status !== "MANUAL_REQUIRED" || current.version !== version || current.payment.provider === "YOOKASSA" || !current.approvedAmountMinor) throw conflict("Ручной возврат недоступен в этом состоянии.");
      const amount = current.approvedAmountMinor;
      const total = current.payment.refundedAmountMinor + amount;
      if (total > current.payment.amountMinor) throw conflict("Возврат превышает оплату.");
      await this.ledger.post(tx, { type: "REFUND", businessReference: `refund-request:${id}:manual`, description: "Подтверждённый владельцем ручной возврат", occurredAt: new Date(), createdBy: actorId, metadata: { requestId: id, paymentId: current.paymentId, provider: current.payment.provider, reference }, entries: [
        { ...(current.heldPrepaidMinor > 0n ? { workspaceId: current.workspaceId } : {}), accountType: current.heldPrepaidMinor > 0n ? "RESERVATION" : "REFUNDS", direction: "DEBIT", amountMinor: amount },
        { accountType: "PAYMENT_CLEARING", direction: "CREDIT", amountMinor: amount }
      ] });
      const status = total === current.payment.amountMinor ? "REFUNDED" as const : "PARTIALLY_REFUNDED" as const;
      await tx.billingPayment.update({ where: { id: current.paymentId }, data: { refundedAmountMinor: total, status, version: { increment: 1 } } });
      await tx.billingOrder.update({ where: { id: current.payment.orderId }, data: { status, version: { increment: 1 } } });
      const completed = await tx.billingRefundRequest.update({ where: { id }, data: { status: "SUCCEEDED", manualReference: reference, version: { increment: 1 } }, include: INCLUDE });
      await this.audit.record({ actorId, workspaceId: row.workspaceId, action: "billing.refund_request.manual_completed", resourceType: "billing_refund_request", resourceId: id, requestId: context.requestId }, tx);
      return summary(completed);
    });
  }

  public async reconcileProviderReference(id: string, actorId: string, externalRefundId: string, context: RequestContext): Promise<void> {
    const row = await this.prisma.billingRefundRequest.findUnique({ where: { id }, include: INCLUDE });
    if (!row?.refund || row.payment.provider !== "YOOKASSA" || !["APPROVED", "PROCESSING"].includes(row.status)) throw conflict("Возврат не ожидает сверки с ЮKassa.");
    await this.billing.verifyRefundReference(row.refund.id, externalRefundId);
    const latest = await this.prisma.billingRefundRequest.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    if (latest.refund?.status === "SUCCEEDED") await this.finish(latest, "SUCCEEDED");
    else if (latest.refund && ["CANCELED", "FAILED_FINAL"].includes(latest.refund.status)) await this.finish(latest, "FAILED");
    await this.audit.record({ actorId, workspaceId: row.workspaceId, action: "billing.refund_request.provider_reconciled", resourceType: "billing_refund_request", resourceId: id, requestId: context.requestId });
  }

  private async finish(row: RequestWithPayment, status: "SUCCEEDED" | "FAILED"): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await workspaceLock(tx, row.workspaceId);
      await tx.$queryRaw`SELECT id FROM billing_refund_requests WHERE id = ${row.id}::uuid FOR UPDATE`;
      const current = await tx.billingRefundRequest.findUniqueOrThrow({ where: { id: row.id }, include: INCLUDE });
      if (!["APPROVED", "PROCESSING"].includes(current.status)) return;
      if (status === "FAILED" && !current.holdReleasedAt) {
        if (current.heldPrepaidMinor > 0n) await this.ledger.post(tx, { type: "RELEASE", businessReference: `refund-request:${row.id}:release`, description: "Возврат не выполнен: резерв снова доступен", occurredAt: new Date(), createdBy: current.decidedBy!, metadata: { requestId: row.id }, entries: [
          { workspaceId: row.workspaceId, accountType: "RESERVATION", direction: "DEBIT", amountMinor: current.heldPrepaidMinor },
          { workspaceId: row.workspaceId, accountType: "CUSTOMER_PREPAID_LIABILITY", direction: "CREDIT", amountMinor: current.heldPrepaidMinor }
        ] });
        if (current.subscriptionAdjustment) await this.restoreSubscriptionValue(tx, current);
      }
      await tx.billingRefundRequest.update({ where: { id: row.id }, data: { status, ...(status === "FAILED" ? { holdReleasedAt: new Date() } : {}), version: { increment: 1 } } });
    });
  }

  private async restoreSubscriptionValue(tx: Prisma.TransactionClient, request: BillingRefundRequest): Promise<void> {
    const now = new Date();
    const current = await tx.billingSubscription.findUniqueOrThrow({ where: { workspaceId: request.workspaceId }, include: { planVersion: { include: { prices: true } } } });
    const value = await subscriptionValueAt(tx, current, now);
    const adjustment = request.subscriptionAdjustment as { durationMs: number; valueMinor: string; refundableFrom: string; planVersionId: string };
    const restored = request.approvedAmountMinor!;
    const remainingMs = Math.max(0, current.currentPeriodEnd.getTime() - now.getTime());
    const monthlyPrice = current.planVersion.prices.find(price => price.period === "MONTHLY" && price.currency === "RUB")?.amountMinor ?? 0n;
    const rateMs = value.remainingMinor > 0n && remainingMs > 0 ? BigInt(remainingMs) : monthlyPrice > 0n ? BigInt(addBillingPeriod(now, "MONTHLY").getTime() - now.getTime()) : BigInt(adjustment.durationMs);
    const rateValue = value.remainingMinor > 0n && remainingMs > 0 ? value.remainingMinor : monthlyPrice > 0n ? monthlyPrice : BigInt(adjustment.valueMinor);
    const additionalMs = (restored * rateMs + rateValue - 1n) / rateValue;
    const origin = new Date(adjustment.refundableFrom);
    await tx.billingSubscription.update({ where: { id: current.id }, data: { serviceValueMinor: value.remainingMinor + restored, serviceValueAt: now, refundableFrom: value.refundableFrom && value.refundableFrom < origin ? value.refundableFrom : origin, currentPeriodEnd: new Date(Math.max(now.getTime(), current.currentPeriodEnd.getTime()) + Number(additionalMs)), status: "CANCELLING", cancelAtPeriodEnd: true, version: { increment: 1 } } });
    await tx.workspace.updateMany({ where: { id: request.workspaceId, status: "READ_ONLY" }, data: { status: "ACTIVE", version: { increment: 1 } } });
  }

  private async eligible(tx: Prisma.TransactionClient, workspaceId: string, paymentId: string, ignoreRequestId?: string): Promise<BillingRefundEligibility> {
    const payment = await tx.billingPayment.findFirst({ where: { id: paymentId, workspaceId }, include: { order: true } }); if (!payment) throw notFound();
    const base = { workspaceId, paymentId, currency: "RUB" as const, requiresManualTransfer: payment.provider !== "YOOKASSA", maximumAmountMinor: 0 };
    if (payment.isTest) return { ...base, reason: "TEST_PAYMENT" };
    if (!["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status) || !payment.succeededAt) return { ...base, reason: "PAYMENT_NOT_SETTLED" };
    if (payment.provider !== "YOOKASSA" && payment.provider !== "CRYPTO_PAY") return { ...base, reason: "METHOD_NOT_SUPPORTED" };
    const open = await tx.billingRefundRequest.findFirst({ where: { paymentId, status: { in: OPEN }, ...(ignoreRequestId ? { id: { not: ignoreRequestId } } : {}) }, select: { id: true } });
    if (open) return { ...base, reason: "OPEN_REQUEST" };
    const legacy = await tx.billingRefund.aggregate({ where: { paymentId, refundRequestId: null, status: { in: ["CREATING", "PENDING", "FAILED_RETRYABLE"] } }, _sum: { amountMinor: true } });
    const paymentRemaining = positive(payment.amountMinor - payment.refundedAmountMinor - (legacy._sum.amountMinor ?? 0n));
    let available: bigint;
    if (payment.order.kind === "TOP_UP") {
      const balance = await this.ledger.balance(tx, workspaceId);
      available = await spendablePrepaidMinor(tx, workspaceId, balance.prepaidMinor);
    } else {
      const subscription = await tx.billingSubscription.findUnique({ where: { workspaceId } });
      const value = await subscriptionValueAt(tx, subscription, new Date());
      available = value.refundableFrom && payment.succeededAt >= value.refundableFrom ? value.remainingMinor : 0n;
    }
    const maximum = min(paymentRemaining, available);
    return { ...base, maximumAmountMinor: Number(maximum), reason: maximum > 0n ? "AVAILABLE" : "NO_UNUSED_VALUE" };
  }
}
function summary(row: RequestWithPayment): BillingRefundRequestSummary { return { id: row.id, workspaceId: row.workspaceId, paymentId: row.paymentId, provider: row.payment.provider, status: row.status as BillingRefundRequestSummary["status"], requestedAmountMinor: Number(row.requestedAmountMinor), ...(row.approvedAmountMinor === null ? {} : { approvedAmountMinor: Number(row.approvedAmountMinor) }), currency: "RUB", reason: row.reason, ...(row.decisionReason ? { decisionReason: row.decisionReason } : {}), createdAt: row.createdAt.toISOString(), ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}), version: row.version }; }
async function workspaceLock(tx: Prisma.TransactionClient, id: string): Promise<void> { await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${id}::uuid FOR UPDATE`; }
function positive(n: bigint) { return n > 0n ? n : 0n; }
function min(a: bigint, b: bigint) { return a < b ? a : b; }
function conflict(message: string, details?: Record<string, unknown>) { return new DomainError({ statusCode: 409, code: "RESOURCE_STATE_CONFLICT", message, ...(details ? { details } : {}) }); }
function notFound() { return new DomainError({ statusCode: 404, code: "NOT_FOUND", message: "Платёж или заявка не найдены." }); }
