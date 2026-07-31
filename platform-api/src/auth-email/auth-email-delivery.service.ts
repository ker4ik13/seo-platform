import { createHash, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  AUTH_EMAIL_COMPLETION_RECEIPT_SCHEMA,
  AUTH_EMAIL_MATERIAL_DECISION_SCHEMA,
  internalAuthEmailCompletionReceipt,
  internalAuthEmailMaterialDecision,
  transactionalEmailEventTypesV1,
  type InternalAuthEmailCompletionReceiptV1,
  type InternalAuthEmailCompletionOutcomeV1,
  type InternalAuthEmailMaterialDecisionV1,
  type TransactionalEmailEventEnvelopeV1
} from "@seo-platform/contracts";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/app-config.js";
import { AuditService } from "../audit/audit.service.js";
import { BillingPiiService } from "../billing/billing-pii.service.js";
import { PrismaService } from "../database/prisma.service.js";
import type { Prisma } from "../generated/prisma/client.js";
import { AuthCryptoService } from "../identity/auth-crypto.service.js";
import {
  transactionalEmailEnvelopeFromOutbox,
  type AuthEmailOutboxRow
} from "./auth-email-outbox.js";

interface AuthEmailOutboxRowWithClock extends AuthEmailOutboxRow {
  readonly database_now: Date;
}

type Transaction = Prisma.TransactionClient;

@Injectable()
export class AuthEmailDeliveryService {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly crypto: AuthCryptoService,
    private readonly pii: BillingPiiService,
    private readonly audit: AuditService
  ) {}

  public async material(
    eventId: string
  ): Promise<InternalAuthEmailMaterialDecisionV1> {
    return this.prisma.$transaction(async (transaction) => {
      const row = await this.outboxRow(transaction, eventId);
      if (!row) return skipped(eventId);
      const envelope = transactionalEmailEnvelopeFromOutbox(row);
      const now = canonicalDatabaseClock(row.database_now);

      if (
        envelope.eventType ===
          transactionalEmailEventTypesV1.emailVerificationRequested ||
        envelope.eventType ===
          transactionalEmailEventTypesV1.passwordResetRequested
      ) {
        return this.identityMaterial(transaction, envelope, now);
      }
      if (
        envelope.eventType ===
        transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested
      ) {
        return this.receiptMaterial(transaction, envelope);
      }
      return this.inviteMaterial(transaction, envelope, now);
    });
  }

  public async complete(
    eventId: string,
    outcome: InternalAuthEmailCompletionOutcomeV1
  ): Promise<InternalAuthEmailCompletionReceiptV1> {
    return this.prisma.$transaction(async (transaction) => {
      const row = await this.outboxRow(transaction, eventId);
      if (!row) throw new TypeError("Auth-email outbox event is unavailable");
      const envelope = transactionalEmailEnvelopeFromOutbox(row);

      if (
        envelope.eventType ===
        transactionalEmailEventTypesV1.workspaceInviteRequested
      ) {
        await transaction.workspaceInvite.updateMany({
          where: {
            id: envelope.data.inviteId,
            workspaceId: envelope.data.workspaceId,
            status: "SENT"
          },
          data: { status: outcome }
        });
      }
      if (
        envelope.eventType ===
        transactionalEmailEventTypesV1.billingNpdReceiptDeliveryRequested
      ) {
        await this.completeReceipt(
          transaction,
          envelope,
          outcome,
          canonicalDatabaseClock(row.database_now)
        );
      }

      return internalAuthEmailCompletionReceipt({
        schemaVersion: AUTH_EMAIL_COMPLETION_RECEIPT_SCHEMA,
        eventId,
        outcome
      });
    });
  }

  private async identityMaterial(
    transaction: Transaction,
    envelope: Extract<
      TransactionalEmailEventEnvelopeV1,
      {
        readonly eventType:
          | "identity.email-verification.requested.v1"
          | "identity.password-reset.requested.v1";
      }
    >,
    now: Date
  ): Promise<InternalAuthEmailMaterialDecisionV1> {
    const record = await transaction.oneTimeToken.findUnique({
      where: { id: envelope.data.oneTimeTokenId },
      include: { user: true }
    });
    if (
      !record ||
      record.userId !== envelope.data.userId ||
      record.user.id !== envelope.aggregate.id ||
      record.consumedAt !== null ||
      record.expiresAt <= now ||
      record.expiresAt.toISOString() !== envelope.data.expiresAt
    ) {
      return skipped(envelope.eventId);
    }

    const isVerification =
      envelope.eventType ===
      transactionalEmailEventTypesV1.emailVerificationRequested;
    if (
      (isVerification &&
        (record.purpose !== "EMAIL_VERIFICATION" ||
          record.user.status !== "PENDING_VERIFICATION" ||
          record.user.emailVerifiedAt !== null)) ||
      (!isVerification &&
        (record.purpose !== "PASSWORD_RESET" ||
          record.user.status !== "ACTIVE" ||
          record.user.emailVerifiedAt === null))
    ) {
      return skipped(envelope.eventId);
    }

    const token = isVerification
      ? this.cryptoToken("EMAIL_VERIFICATION", record)
      : this.cryptoToken("PASSWORD_RESET", record);
    if (
      !tokenHashesEqual(
        record.tokenHash,
        this.crypto.hashOpaqueToken(token)
      )
    ) {
      return skipped(envelope.eventId);
    }

    return ready({
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      recipient: record.user.emailDisplay,
      locale: envelope.data.locale,
      expiresAt: envelope.data.expiresAt,
      actionUrl: this.actionUrl(
        isVerification ? "/app/verify-email" : "/app/reset-password",
        token
      )
    });
  }

  private async inviteMaterial(
    transaction: Transaction,
    envelope: Extract<
      TransactionalEmailEventEnvelopeV1,
      { readonly eventType: "workspace.invite.requested.v1" }
    >,
    now: Date
  ): Promise<InternalAuthEmailMaterialDecisionV1> {
    const invite = await transaction.workspaceInvite.findUnique({
      where: { id: envelope.data.inviteId },
      include: { workspace: true }
    });
    if (
      !invite ||
      invite.workspaceId !== envelope.data.workspaceId ||
      invite.status !== "SENT" ||
      invite.expiresAt <= now ||
      invite.expiresAt.toISOString() !== envelope.data.expiresAt ||
      ["SUSPENDED", "DELETING", "DELETED"].includes(
        invite.workspace.status
      )
    ) {
      return skipped(envelope.eventId);
    }

    const token = this.cryptoToken("WORKSPACE_INVITE", invite);
    if (
      !tokenHashesEqual(
        invite.tokenHash,
        this.crypto.hashOpaqueToken(token)
      )
    ) {
      return skipped(envelope.eventId);
    }

    return ready({
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      recipient: invite.emailDisplay,
      locale: invite.workspace.locale,
      expiresAt: envelope.data.expiresAt,
      actionUrl: this.actionUrl(
        "/app/workspace-invites/accept",
        token
      )
    });
  }

  private async receiptMaterial(
    transaction: Transaction,
    envelope: Extract<
      TransactionalEmailEventEnvelopeV1,
      {
        readonly eventType:
          "billing.npd-receipt.delivery-requested.v1";
      }
    >
  ): Promise<InternalAuthEmailMaterialDecisionV1> {
    const receipt = await transaction.npdReceiptObligation.findUnique({
      where: { id: envelope.data.receiptId },
      include: {
        workspace: {
          select: { locale: true, status: true }
        },
        payment: {
          select: { orderId: true }
        }
      }
    });
    if (
      !receipt ||
      receipt.workspaceId !== envelope.data.workspaceId ||
      receipt.workspaceId !== envelope.workspaceId ||
      receipt.id !== envelope.aggregate.id ||
      receipt.version !== envelope.aggregate.version ||
      receipt.status !== "DELIVERY_PENDING" ||
      receipt.currency !== "RUB" ||
      !receipt.officialReceiptId ||
      !receipt.officialReceiptUrl ||
      !receipt.registeredAt ||
      receipt.grossAmountMinor <= 0n ||
      receipt.grossAmountMinor > BigInt(Number.MAX_SAFE_INTEGER) ||
      ["SUSPENDED", "DELETING", "DELETED"].includes(
        receipt.workspace.status
      )
    ) {
      return skipped(envelope.eventId);
    }

    return readyReceipt({
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      recipient: this.pii.open(
        receipt.deliveryEmailEncrypted,
        `order:${receipt.payment.orderId}:delivery-email`
      ),
      locale: receipt.workspace.locale,
      officialReceiptId: receipt.officialReceiptId,
      receiptUrl: receipt.officialReceiptUrl,
      grossAmountMinor: Number(receipt.grossAmountMinor),
      currency: "RUB",
      serviceDescription: receipt.serviceDescriptionSnapshot
    });
  }

  private async completeReceipt(
    transaction: Transaction,
    envelope: Extract<
      TransactionalEmailEventEnvelopeV1,
      {
        readonly eventType:
          "billing.npd-receipt.delivery-requested.v1";
      }
    >,
    outcome: InternalAuthEmailCompletionOutcomeV1,
    now: Date
  ): Promise<void> {
    const receipt = await transaction.npdReceiptObligation.findUnique({
      where: { id: envelope.data.receiptId }
    });
    const targetStatus =
      outcome === "DELIVERED" ? "DELIVERED" : "FAILED_FINAL";
    if (
      !receipt ||
      receipt.workspaceId !== envelope.workspaceId ||
      receipt.id !== envelope.aggregate.id
    ) {
      throw new TypeError("NPD receipt delivery state is unavailable");
    }
    if (
      receipt.status === targetStatus &&
      receipt.version === envelope.aggregate.version + 1
    ) {
      return;
    }
    if (
      receipt.status !== "DELIVERY_PENDING" ||
      receipt.version !== envelope.aggregate.version
    ) {
      throw new TypeError("NPD receipt delivery state has changed");
    }
    const updated = await transaction.npdReceiptObligation.updateMany({
      where: {
        id: receipt.id,
        workspaceId: envelope.workspaceId,
        status: "DELIVERY_PENDING",
        version: envelope.aggregate.version
      },
      data: {
        status: targetStatus,
        ...(outcome === "DELIVERED" ? { deliveredAt: now } : {}),
        deliveryAttempts: { increment: 1 },
        version: { increment: 1 }
      }
    });
    if (updated.count !== 1) {
      throw new TypeError("NPD receipt delivery state has changed");
    }
    await this.audit.record(
      {
        workspaceId: receipt.workspaceId,
        action:
          outcome === "DELIVERED"
            ? "billing.npd_receipt.delivered"
            : "billing.npd_receipt.delivery_bounced",
        resourceType: "npd_receipt_obligation",
        resourceId: receipt.id,
        requestId: `auth-email-complete-${envelope.eventId}`
      },
      transaction
    );
  }

  private cryptoToken(
    purpose: "EMAIL_VERIFICATION" | "PASSWORD_RESET",
    record: {
      readonly id: string;
      readonly userId: string;
      readonly expiresAt: Date;
    }
  ): string;
  private cryptoToken(
    purpose: "WORKSPACE_INVITE",
    record: {
      readonly id: string;
      readonly workspaceId: string;
      readonly emailNormalized: string;
      readonly expiresAt: Date;
    }
  ): string;
  private cryptoToken(
    purpose:
      | "EMAIL_VERIFICATION"
      | "PASSWORD_RESET"
      | "WORKSPACE_INVITE",
    record: {
      readonly id: string;
      readonly userId?: string;
      readonly workspaceId?: string;
      readonly emailNormalized?: string;
      readonly expiresAt: Date;
    }
  ): string {
    if (purpose === "EMAIL_VERIFICATION" && record.userId) {
      return this.crypto.emailVerificationToken(
        record.id,
        record.userId,
        record.expiresAt
      );
    }
    if (purpose === "PASSWORD_RESET" && record.userId) {
      return this.crypto.passwordResetToken(
        record.id,
        record.userId,
        record.expiresAt
      );
    }
    if (
      purpose === "WORKSPACE_INVITE" &&
      record.workspaceId &&
      record.emailNormalized
    ) {
      return this.crypto.workspaceInvitationToken(
        record.id,
        record.workspaceId,
        record.emailNormalized,
        record.expiresAt
      );
    }
    throw new TypeError("Auth-email token state is invalid");
  }

  private actionUrl(path: string, token: string): string {
    const origin = this.config.webPublicUrl;
    if (!origin) {
      throw new TypeError("Auth-email public URL is unavailable");
    }
    return `${origin}${path}#token=${encodeURIComponent(token)}`;
  }

  private async outboxRow(
    transaction: Transaction,
    eventId: string
  ): Promise<AuthEmailOutboxRowWithClock | undefined> {
    const rows = await transaction.$queryRaw<AuthEmailOutboxRowWithClock[]>`
      SELECT
        id,
        event_type,
        aggregate_type,
        aggregate_id,
        aggregate_version,
        workspace_id,
        project_id,
        payload,
        metadata,
        attempts,
        created_at,
        CURRENT_TIMESTAMP AS database_now
      FROM outbox_events
      WHERE id = ${eventId}::uuid
      LIMIT 1
    `;
    return rows[0];
  }
}

function canonicalDatabaseClock(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("Auth-email database clock is invalid");
  }
  return value;
}

function skipped(eventId: string): InternalAuthEmailMaterialDecisionV1 {
  return internalAuthEmailMaterialDecision({
    schemaVersion: AUTH_EMAIL_MATERIAL_DECISION_SCHEMA,
    decision: "SKIPPED",
    eventId,
    reason: "NOT_DELIVERABLE"
  });
}

function ready(
  input: Omit<
    Extract<InternalAuthEmailMaterialDecisionV1, { decision: "READY" }>,
    "schemaVersion" | "decision"
  >
): InternalAuthEmailMaterialDecisionV1 {
  return internalAuthEmailMaterialDecision({
    schemaVersion: AUTH_EMAIL_MATERIAL_DECISION_SCHEMA,
    decision: "READY",
    ...input
  });
}

function readyReceipt(
  input: Omit<
    Extract<
      InternalAuthEmailMaterialDecisionV1,
      { decision: "READY_RECEIPT" }
    >,
    "schemaVersion" | "decision"
  >
): InternalAuthEmailMaterialDecisionV1 {
  return internalAuthEmailMaterialDecision({
    schemaVersion: AUTH_EMAIL_MATERIAL_DECISION_SCHEMA,
    decision: "READY_RECEIPT",
    ...input
  });
}

export function tokenHashesEqual(
  storedHash: string,
  computedHash: string
): boolean {
  const stored = createHash("sha256").update(storedHash).digest();
  const computed = createHash("sha256").update(computedHash).digest();
  return timingSafeEqual(stored, computed);
}
