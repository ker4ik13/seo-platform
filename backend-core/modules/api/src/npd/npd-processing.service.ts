import { randomUUID } from "node:crypto";
import { ConflictException, Injectable } from "@nestjs/common";
import { transactionalEmailEventTypesV1, transactionalEmailNpdReceiptAggregateTypeV1, type InternalNpdIssueMaterial, type InternalNpdIssueResult } from "@seo-platform/contracts";
import { PrismaService } from "../database/prisma.service.js";
import { BillingPiiService } from "../billing/billing-pii.service.js";
import { OutboxService } from "../outbox/outbox.service.js";

@Injectable()
export class NpdProcessingService {
  public constructor(private readonly prisma: PrismaService, private readonly pii: BillingPiiService) {}
  public async claim(): Promise<InternalNpdIssueMaterial | null> {
    return this.prisma.$transaction(async transaction => {
      await transaction.$executeRaw`
        UPDATE npd_receipt_obligations SET issue_state = 'UNKNOWN', issue_error_code = 'NPD_ISSUE_OUTCOME_UNKNOWN'
        WHERE id IN (SELECT id FROM npd_receipt_obligations
          WHERE issue_state = 'STARTED' AND issue_lease_expires_at < clock_timestamp()
          ORDER BY issue_lease_expires_at, id FOR UPDATE SKIP LOCKED LIMIT 100)
      `;
      const [candidate] = await transaction.$queryRaw<{ id: string }[]>`
        SELECT r.id FROM npd_receipt_obligations r
        JOIN billing_payments p ON p.id = r.payment_id
        WHERE r.status = 'AWAITING_MANUAL_REGISTRATION' AND r.official_receipt_id IS NULL
          AND p.provider = 'YOOKASSA' AND p.is_test = false AND p.status IN ('SUCCEEDED', 'PARTIALLY_REFUNDED')
          AND r.issue_started_at IS NULL
          AND (r.issue_state = 'PENDING' OR (r.issue_state = 'CLAIMED' AND r.issue_lease_expires_at < clock_timestamp()))
        ORDER BY r.created_at, r.id FOR UPDATE OF r SKIP LOCKED LIMIT 1
      `;
      if (!candidate) return null;
      const leaseToken = randomUUID();
      const row = await transaction.npdReceiptObligation.update({ where: { id: candidate.id }, data: { issueState: "CLAIMED", issueLeaseToken: leaseToken, issueLeaseExpiresAt: new Date(Date.now() + 120_000), issueErrorCode: null }, include: { payment: true } });
      try {
        return { receiptId: row.id, leaseToken, amountMinor: row.grossAmountMinor.toString(), paidAt: row.paidAt.toISOString(), description: row.serviceDescriptionSnapshot, buyerType: row.buyerType,
          ...(row.buyerNameEncrypted ? { buyerName: this.pii.open(row.buyerNameEncrypted, `order:${row.payment.orderId}:buyer-name`) } : {}),
          ...(row.buyerInnEncrypted ? { buyerInn: this.pii.open(row.buyerInnEncrypted, `order:${row.payment.orderId}:buyer-inn`) } : {}) };
      } catch {
        // A damaged buyer envelope must not roll back the claim and starve
        // every subsequent receipt. Keep this obligation for manual review.
        await transaction.npdReceiptObligation.update({ where: { id: row.id }, data: { issueState: "FAILED", issueErrorCode: "NPD_BUYER_MATERIAL_INVALID" } });
        return null;
      }
    });
  }
  public async start(receiptId: string, leaseToken: string): Promise<void> {
    const result = await this.prisma.npdReceiptObligation.updateMany({ where: { id: receiptId, issueLeaseToken: leaseToken, issueState: "CLAIMED", issueStartedAt: null, issueLeaseExpiresAt: { gt: new Date() }, status: "AWAITING_MANUAL_REGISTRATION", officialReceiptId: null }, data: { issueState: "STARTED", issueStartedAt: new Date() } });
    if (result.count !== 1) throw new ConflictException("NPD issue lease is no longer current");
  }
  public async complete(input: InternalNpdIssueResult): Promise<void> {
    if (!/^[A-Za-z0-9_-]{5,128}$/u.test(input.officialReceiptId)) throw new ConflictException("Invalid receipt reference");
    const url = new URL(input.officialReceiptUrl);
    if (url.origin !== "https://lknpd.nalog.ru" || url.username || url.password || url.search || url.hash || !/^\/api\/v1\/receipt\/\d{12}\/[A-Za-z0-9_-]+\/print$/u.test(url.pathname) || !url.pathname.includes(`/${input.officialReceiptId}/`)) throw new ConflictException("Invalid official receipt URL");
    await this.prisma.$transaction(async transaction => {
      await transaction.$queryRaw`SELECT id FROM npd_receipt_obligations WHERE id = ${input.receiptId}::uuid FOR UPDATE`;
      const receipt = await transaction.npdReceiptObligation.findUnique({ where: { id: input.receiptId } });
      if (!receipt) throw new ConflictException("Receipt not found");
      if (receipt.issueLeaseToken !== input.leaseToken) throw new ConflictException("Receipt issue lease changed");
      if (receipt.officialReceiptId === input.officialReceiptId) return;
      if (receipt.issueLeaseToken !== input.leaseToken || !receipt.issueStartedAt || receipt.officialReceiptId) throw new ConflictException("Receipt issue scope changed");
      const requiresReview = ["CANCELLATION_PENDING", "REPLACEMENT_REQUIRED", "CANCELLED"].includes(receipt.status);
      const updated = await transaction.npdReceiptObligation.update({ where: { id: receipt.id }, data: { officialReceiptId: input.officialReceiptId, officialReceiptUrl: url.toString(), registeredAt: new Date(), registrationMode: "API_MY_TAX", issueState: "COMPLETED", issueErrorCode: null, status: requiresReview ? receipt.status : "DELIVERY_PENDING", version: { increment: 1 } } });
      if (!requiresReview) await new OutboxService().event(transaction, { eventType: transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested, aggregateType: transactionalEmailNpdReceiptAggregateTypeV1, aggregateId: updated.id, aggregateVersion: updated.version, workspaceId: updated.workspaceId, payload: { receiptId: updated.id, workspaceId: updated.workspaceId }, requestId: `npd-issue-${updated.id}` });
    });
  }
  public async fail(receiptId: string, leaseToken: string, _started: boolean): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE npd_receipt_obligations
      SET issue_state = CASE WHEN issue_started_at IS NULL THEN 'FAILED' ELSE 'UNKNOWN' END,
          issue_error_code = CASE WHEN issue_started_at IS NULL THEN 'NPD_AUTH_OR_INPUT_FAILED' ELSE 'NPD_ISSUE_OUTCOME_UNKNOWN' END
      WHERE id = ${receiptId}::uuid AND issue_lease_token = ${leaseToken}::uuid
        AND issue_state IN ('CLAIMED', 'STARTED')
    `;
  }
}
