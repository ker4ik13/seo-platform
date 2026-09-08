import { Inject, Injectable } from "@nestjs/common";
import { AUTH_EMAIL_MATERIAL_DECISION_SCHEMA, internalAuthEmailMaterialDecision, transactionalEmailEventTypesV1, type BillingNoticeKind, type InternalAuthEmailMaterialDecisionV1 } from "@seo-platform/contracts";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";

type Candidate = { workspaceId: string; recipientUserId: string; referenceId: string; referenceState: string | null; kind: BillingNoticeKind; periodEnd: Date | null; businessKey: string };
const DAY = 86_400_000;

/** Billing owns notice intent; the existing isolated email role owns SMTP delivery. */
@Injectable()
export class BillingNoticeService {
  public constructor(private readonly prisma: PrismaService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public async scan(): Promise<number> {
    return this.prisma.$transaction(async tx => {
      const [lease] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended('billing-notices-scan', 0)) AS locked`;
      if (!lease?.locked) return 0;
      // NOT EXISTS makes every page advance even when more than 100 events arrive.
      // No customer text, email address, payment object or token enters the outbox.
      const candidates = await tx.$queryRaw<Candidate[]>`
        WITH candidates AS (
          SELECT p.workspace_id, o.created_by AS recipient_user_id, p.id AS reference_id,
            NULL::varchar AS reference_state, 'PAYMENT_SUCCEEDED'::text AS kind,
            NULL::timestamptz AS period_end, 'payment:' || p.id::text AS business_key
          FROM billing_payments p JOIN billing_orders o ON o.id = p.order_id AND o.workspace_id = p.workspace_id
          WHERE p.is_test = false AND p.status IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED') AND p.succeeded_at >= now() - interval '7 days'
          UNION ALL
          SELECT r.workspace_id, r.requested_by, r.id, r.status,
            'REFUND_' || CASE WHEN r.status IN ('PROCESSING', 'MANUAL_REQUIRED') THEN 'APPROVED' ELSE r.status END,
            NULL::timestamptz, 'refund:' || r.id::text || ':' || CASE WHEN r.status IN ('PROCESSING', 'MANUAL_REQUIRED') THEN 'APPROVED' ELSE r.status END
          FROM billing_refund_requests r JOIN billing_payments p ON p.id = r.payment_id AND p.workspace_id = r.workspace_id
          WHERE p.is_test = false AND r.updated_at >= now() - interval '7 days' AND r.status IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'MANUAL_REQUIRED', 'REJECTED', 'SUCCEEDED', 'FAILED')
          UNION ALL
          SELECT s.workspace_id, w.owner_user_id, s.id, NULL::varchar,
            CASE WHEN s.current_period_end <= now() THEN 'SUBSCRIPTION_EXPIRED' WHEN s.current_period_end <= now() + interval '1 day' THEN 'SUBSCRIPTION_ENDING_1D' ELSE 'SUBSCRIPTION_ENDING_3D' END,
            s.current_period_end, 'subscription:' || s.id::text || ':' || extract(epoch FROM s.current_period_end)::text || ':' || CASE WHEN s.current_period_end <= now() THEN 'expired' WHEN s.current_period_end <= now() + interval '1 day' THEN '1d' ELSE '3d' END
          FROM billing_subscriptions s JOIN workspaces w ON w.id = s.workspace_id
          WHERE (s.provider IS NOT NULL OR s.status = 'TRIALING') AND s.status <> 'SUSPENDED' AND s.current_period_end BETWEEN now() - interval '7 days' AND now() + interval '3 days'
        )
        SELECT c.workspace_id AS "workspaceId", c.recipient_user_id AS "recipientUserId", c.reference_id AS "referenceId", c.reference_state AS "referenceState", c.kind, c.period_end AS "periodEnd", c.business_key AS "businessKey"
        FROM candidates c JOIN workspaces w ON w.id = c.workspace_id JOIN users u ON u.id = c.recipient_user_id
        WHERE w.status IN ('ACTIVE', 'READ_ONLY') AND u.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM billing_notices n WHERE n.business_key = c.business_key)
        ORDER BY c.business_key LIMIT 100
      `;
      for (const candidate of candidates) {
        const notice = await tx.billingNotice.create({ data: candidate });
        await tx.outboxEvent.create({ data: { eventType: transactionalEmailEventTypesV1.billingNoticeRequested, aggregateType: "billingNotice", aggregateId: notice.id, aggregateVer: 1, workspaceId: notice.workspaceId, payload: { noticeId: notice.id, workspaceId: notice.workspaceId }, metadata: { requestId: `billing-notice-${notice.id}`, producer: "platform-api" } } });
      }
      return candidates.length;
    }, { timeout: 15_000 });
  }

  public async material(tx: Prisma.TransactionClient, noticeId: string, workspaceId: string, eventId: string, now: Date): Promise<InternalAuthEmailMaterialDecisionV1> {
    const skip = (): InternalAuthEmailMaterialDecisionV1 => ({ schemaVersion: AUTH_EMAIL_MATERIAL_DECISION_SCHEMA, decision: "SKIPPED", eventId, reason: "NOT_DELIVERABLE" });
    const notice = await tx.billingNotice.findUnique({ where: { id: noticeId }, include: { workspace: true, recipient: true } });
    if (!notice || notice.workspaceId !== workspaceId || !this.config.webPublicUrl || notice.createdAt.getTime() + 7 * DAY < now.getTime() || !["ACTIVE", "READ_ONLY"].includes(notice.workspace.status) || notice.recipient.status !== "ACTIVE" || !notice.recipient.emailVerifiedAt) return skip();
    const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: notice.recipientUserId } } });
    if (!member || member.status !== "ACTIVE" || !["OWNER", "ADMIN", "SEO_LEAD"].includes(member.roleCode)) return skip();
    let amountMinor: number | undefined;
    if (notice.kind === "PAYMENT_SUCCEEDED") {
      const payment = await tx.billingPayment.findUnique({ where: { id: notice.referenceId } });
      if (!payment || payment.workspaceId !== workspaceId || payment.isTest || !["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status)) return skip();
      amountMinor = Number(payment.amountMinor);
    } else if (notice.kind.startsWith("REFUND_")) {
      const refund = await tx.billingRefundRequest.findUnique({ where: { id: notice.referenceId }, include: { payment: true } });
      if (!refund || refund.workspaceId !== workspaceId || refund.payment.isTest) return skip();
      const status = ["APPROVED", "PROCESSING", "MANUAL_REQUIRED"].includes(refund.status) ? "APPROVED" : refund.status;
      if (notice.kind !== `REFUND_${status}`) return skip();
      amountMinor = Number(refund.approvedAmountMinor ?? refund.requestedAmountMinor);
    } else {
      const subscription = await tx.billingSubscription.findUnique({ where: { id: notice.referenceId } });
      if (!subscription || subscription.workspaceId !== workspaceId || !notice.periodEnd || subscription.currentPeriodEnd.getTime() !== notice.periodEnd.getTime() || subscription.status === "SUSPENDED") return skip();
      const remaining = notice.periodEnd.getTime() - now.getTime();
      if (notice.kind === "SUBSCRIPTION_EXPIRED" ? remaining > 0 : remaining <= 0 || remaining > 3 * DAY || notice.kind === "SUBSCRIPTION_ENDING_3D" && remaining <= DAY || notice.kind === "SUBSCRIPTION_ENDING_1D" && remaining > DAY) return skip();
    }
    return internalAuthEmailMaterialDecision({ schemaVersion: AUTH_EMAIL_MATERIAL_DECISION_SCHEMA, decision: "READY_NOTICE", eventId, eventType: transactionalEmailEventTypesV1.billingNoticeRequested, recipient: notice.recipient.emailDisplay, locale: notice.recipient.locale, kind: notice.kind, workspaceName: notice.workspace.name, billingUrl: `${this.config.webPublicUrl}/app/settings/billing`, ...(amountMinor === undefined ? {} : { amountMinor }), ...(notice.periodEnd ? { periodEnd: notice.periodEnd.toISOString() } : {}) });
  }
}
