import { Injectable } from "@nestjs/common";
import type {
  AdminNpdReceiptDetail,
  AdminNpdReceiptListPage,
  AdminNpdReceiptSummary,
  AssignPlatformStaffRoleInput,
  CancelManualNpdReceiptInput,
  PlatformAdminProfile,
  PlatformStaffRoleAssignmentSummary,
  RegisterManualNpdReceiptInput,
  ReplaceManualNpdReceiptInput,
  RevokePlatformStaffRoleInput
} from "@seo-platform/contracts";
import { AuditService } from "../audit/audit.service.js";
import { DomainError, isUniqueConstraintError } from "../common/domain-error.js";
import { PrismaService } from "../database/prisma.service.js";
import type {
  NpdReceiptObligation,
  PlatformRoleCode,
  Prisma
} from "../generated/prisma/client.js";
import type {
  AuthenticatedPrincipal,
  RequestContext
} from "../identity/identity.types.js";
import { BillingPiiService } from "../billing/billing-pii.service.js";

const RECEIPT_LIST_LIMIT = 100;

@Injectable()
export class PlatformAdminService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly pii: BillingPiiService,
    private readonly audit: AuditService
  ) {}

  public async profile(
    principal: AuthenticatedPrincipal,
    roles: readonly PlatformRoleCode[]
  ): Promise<PlatformAdminProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: {
        emailDisplay: true,
        displayName: true
      }
    });
    if (!user) throw notFound();
    return {
      userId: principal.userId,
      email: user.emailDisplay,
      displayName: user.displayName,
      roles,
      mfaVerified: true,
      authenticatedAt: principal.authenticatedAt.toISOString()
    };
  }

  public async listNpdReceipts(
    cursorId: string | undefined,
    status: NpdReceiptObligation["status"] | undefined,
    now = new Date()
  ): Promise<AdminNpdReceiptListPage> {
    const cursor = cursorId
      ? await this.prisma.npdReceiptObligation.findUnique({
          where: { id: cursorId },
          select: { paidAt: true, id: true }
        })
      : undefined;
    if (cursorId && !cursor) throw notFound();
    const receipts = await this.prisma.npdReceiptObligation.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(cursor
          ? {
              OR: [
                { paidAt: { lt: cursor.paidAt } },
                { paidAt: cursor.paidAt, id: { lt: cursor.id } }
              ]
            }
          : {})
      },
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      take: RECEIPT_LIST_LIMIT + 1
    });
    const page = receipts.slice(0, RECEIPT_LIST_LIMIT);
    return {
      data: page.map((receipt) => receiptSummary(receipt, now)),
      ...(receipts.length > RECEIPT_LIST_LIMIT && page.at(-1)
        ? { nextCursor: page.at(-1)!.id }
        : {})
    };
  }

  public async npdReceipt(
    id: string,
    actorId: string,
    context: RequestContext,
    now = new Date()
  ): Promise<AdminNpdReceiptDetail> {
    const receipt = await this.prisma.npdReceiptObligation.findUnique({
      where: { id },
      include: {
        payment: {
          select: {
            orderId: true,
            status: true,
            refundedAmountMinor: true
          }
        }
      }
    });
    if (!receipt) throw notFound();
    const detail: AdminNpdReceiptDetail = {
      ...receiptSummary(receipt, now),
      buyerType: receipt.buyerType,
      ...(receipt.buyerNameEncrypted
        ? {
            buyerName: this.pii.open(
              receipt.buyerNameEncrypted,
              `order:${receipt.payment.orderId}:buyer-name`
            )
          }
        : {}),
      ...(receipt.buyerInnEncrypted
        ? {
            buyerInn: this.pii.open(
              receipt.buyerInnEncrypted,
              `order:${receipt.payment.orderId}:buyer-inn`
            )
          }
        : {}),
      deliveryEmail: this.pii.open(
        receipt.deliveryEmailEncrypted,
        `order:${receipt.payment.orderId}:delivery-email`
      ),
      refundedAmountMinor: safeMinor(receipt.payment.refundedAmountMinor),
      paymentStatus: receipt.payment.status,
      ...(receipt.cancellationReason
        ? { cancellationReason: receipt.cancellationReason }
        : {}),
      ...(receipt.cancellationOfficialReference
        ? {
            cancellationOfficialReference:
              receipt.cancellationOfficialReference
          }
        : {})
    };
    await this.audit.record({
      actorId,
      workspaceId: receipt.workspaceId,
      action: "platform_admin.npd_receipt.pii_viewed",
      resourceType: "npd_receipt_obligation",
      resourceId: receipt.id,
      requestId: context.requestId
    });
    return detail;
  }

  public async registerManualNpdReceipt(
    id: string,
    version: number,
    input: RegisterManualNpdReceiptInput,
    actorId: string,
    context: RequestContext
  ): Promise<AdminNpdReceiptSummary> {
    const updated = await this.prisma.$transaction(async (transaction) => {
      const receipt = await transaction.npdReceiptObligation.findUnique({
        where: { id },
        include: { payment: { select: { status: true } } }
      });
      if (!receipt) throw notFound();
      if (
        !["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
          receipt.payment.status
        )
      ) {
        throw stateConflict(
          "The provider payment is not confirmed as succeeded"
        );
      }
      if (
        ![
          "PENDING",
          "AWAITING_MANUAL_REGISTRATION",
          "FAILED_RETRYABLE",
          "CANCELLATION_PENDING",
          "REPLACEMENT_REQUIRED"
        ].includes(receipt.status)
      ) {
        throw stateConflict(
          "The receipt is not awaiting manual registration"
        );
      }
      if (
        receipt.officialReceiptId ||
        receipt.officialReceiptUrl ||
        receipt.registeredAt
      ) {
        throw stateConflict("The official receipt is already registered");
      }
      const changed = await transaction.npdReceiptObligation.updateMany({
        where: { id, version, status: receipt.status },
        data: {
          officialReceiptId: input.officialReceiptId,
          officialReceiptUrl: input.officialReceiptUrl,
          registeredAt: new Date(input.registeredAt),
          status: ["CANCELLATION_PENDING", "REPLACEMENT_REQUIRED"].includes(
            receipt.status
          )
            ? receipt.status
            : "DELIVERY_PENDING",
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) throw versionConflict(receipt.version);
      await this.audit.record(
        {
          actorId,
          workspaceId: receipt.workspaceId,
          action: "platform_admin.npd_receipt.registered_manually",
          resourceType: "npd_receipt_obligation",
          resourceId: receipt.id,
          reason: input.reason,
          requestId: context.requestId
        },
        transaction
      );
      return transaction.npdReceiptObligation.findUniqueOrThrow({
        where: { id }
      });
    });
    return receiptSummary(updated, new Date());
  }

  public async cancelManualNpdReceipt(
    id: string,
    version: number,
    input: CancelManualNpdReceiptInput,
    actorId: string,
    context: RequestContext
  ): Promise<AdminNpdReceiptSummary> {
    const updated = await this.prisma.$transaction(async (transaction) => {
      const receipt = await transaction.npdReceiptObligation.findUnique({
        where: { id },
        include: {
          payment: {
            select: {
              amountMinor: true,
              refundedAmountMinor: true,
              status: true
            }
          }
        }
      });
      if (!receipt) throw notFound();
      if (
        receipt.payment.status !== "REFUNDED" ||
        receipt.payment.refundedAmountMinor < receipt.payment.amountMinor
      ) {
        throw stateConflict(
          "A confirmed full YooKassa refund is required before cancellation"
        );
      }
      if (receipt.status !== "CANCELLATION_PENDING") {
        throw stateConflict("The receipt is not awaiting cancellation");
      }
      if (
        !receipt.officialReceiptId ||
        !receipt.officialReceiptUrl ||
        !receipt.registeredAt
      ) {
        throw stateConflict(
          "Register the original receipt before recording cancellation"
        );
      }
      const changed = await transaction.npdReceiptObligation.updateMany({
        where: { id, version, status: "CANCELLATION_PENDING" },
        data: {
          status: "CANCELLED",
          cancellationReason: input.reason,
          cancellationOfficialReference:
            input.cancellationOfficialReference,
          cancelledAt: new Date(input.cancelledAt),
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1) throw versionConflict(receipt.version);
      await this.audit.record(
        {
          actorId,
          workspaceId: receipt.workspaceId,
          action: "platform_admin.npd_receipt.cancellation_recorded",
          resourceType: "npd_receipt_obligation",
          resourceId: receipt.id,
          reason: input.reason,
          requestId: context.requestId
        },
        transaction
      );
      return transaction.npdReceiptObligation.findUniqueOrThrow({
        where: { id }
      });
    });
    return receiptSummary(updated, new Date());
  }

  public async replaceManualNpdReceipt(
    id: string,
    version: number,
    input: ReplaceManualNpdReceiptInput,
    actorId: string,
    context: RequestContext
  ): Promise<AdminNpdReceiptSummary> {
    const replacement = await this.prisma.$transaction(
      async (transaction) => {
        const receipt = await transaction.npdReceiptObligation.findUnique({
          where: { id },
          include: {
            payment: {
              select: {
                amountMinor: true,
                refundedAmountMinor: true,
                status: true
              }
            }
          }
        });
        if (!receipt) throw notFound();
        if (
          receipt.payment.status !== "PARTIALLY_REFUNDED" ||
          receipt.payment.refundedAmountMinor <= 0n ||
          receipt.payment.refundedAmountMinor >= receipt.payment.amountMinor
        ) {
          throw stateConflict(
            "A confirmed partial YooKassa refund is required before replacement"
          );
        }
        if (receipt.status !== "REPLACEMENT_REQUIRED") {
          throw stateConflict("The receipt does not require replacement");
        }
        if (
          !receipt.officialReceiptId ||
          !receipt.officialReceiptUrl ||
          !receipt.registeredAt
        ) {
          throw stateConflict(
            "Register the original receipt before recording replacement"
          );
        }
        const remaining =
          receipt.payment.amountMinor - receipt.payment.refundedAmountMinor;
        const nextSequence = receipt.sequence + 1;
        const changed = await transaction.npdReceiptObligation.updateMany({
          where: { id, version, status: "REPLACEMENT_REQUIRED" },
          data: {
            status: "CANCELLED",
            cancellationReason: input.reason,
            cancellationOfficialReference:
              input.cancellationOfficialReference,
            cancelledAt: new Date(input.cancelledAt),
            version: { increment: 1 }
          }
        });
        if (changed.count !== 1) throw versionConflict(receipt.version);
        const created = await transaction.npdReceiptObligation.create({
          data: {
            paymentId: receipt.paymentId,
            yookassaPaymentId: receipt.yookassaPaymentId,
            sequence: nextSequence,
            workspaceId: receipt.workspaceId,
            grossAmountMinor: remaining,
            currency: receipt.currency,
            paidAt: receipt.paidAt,
            serviceDescriptionSnapshot:
              receipt.serviceDescriptionSnapshot,
            buyerType: receipt.buyerType,
            ...(receipt.buyerNameEncrypted
              ? { buyerNameEncrypted: receipt.buyerNameEncrypted }
              : {}),
            ...(receipt.buyerInnEncrypted
              ? { buyerInnEncrypted: receipt.buyerInnEncrypted }
              : {}),
            deliveryEmailEncrypted: receipt.deliveryEmailEncrypted,
            registrationMode: receipt.registrationMode,
            status: "DELIVERY_PENDING",
            officialReceiptId: input.officialReceiptId,
            officialReceiptUrl: input.officialReceiptUrl,
            registeredAt: new Date(input.registeredAt)
          }
        });
        await transaction.npdReceiptObligation.update({
          where: { id },
          data: {
            replacementReceiptId: created.id,
            version: { increment: 1 }
          }
        });
        await this.audit.record(
          {
            actorId,
            workspaceId: receipt.workspaceId,
            action: "platform_admin.npd_receipt.replaced_after_refund",
            resourceType: "npd_receipt_obligation",
            resourceId: receipt.id,
            reason: input.reason,
            requestId: context.requestId
          },
          transaction
        );
        return created;
      }
    );
    return receiptSummary(replacement, new Date());
  }

  public async listStaffRoles(): Promise<
    readonly PlatformStaffRoleAssignmentSummary[]
  > {
    const assignments =
      await this.prisma.platformStaffRoleAssignment.findMany({
        include: {
          user: {
            select: { emailDisplay: true, displayName: true }
          }
        },
        orderBy: [{ revokedAt: "asc" }, { assignedAt: "desc" }],
        take: 500
      });
    return assignments.map(roleSummary);
  }

  public async assignStaffRole(
    input: AssignPlatformStaffRoleInput,
    actorId: string,
    context: RequestContext
  ): Promise<PlatformStaffRoleAssignmentSummary> {
    try {
      const assignment = await this.prisma.$transaction(
        async (transaction) => {
          await staffRoleLock(transaction);
          const user = await transaction.user.findUnique({
            where: { id: input.userId },
            select: {
              status: true,
              emailVerifiedAt: true,
              mfaMethods: {
                where: {
                  status: "ACTIVE",
                  disabledAt: null,
                  confirmedAt: { not: null }
                },
                take: 1
              }
            }
          });
          if (
            !user ||
            user.status !== "ACTIVE" ||
            !user.emailVerifiedAt ||
            user.mfaMethods.length === 0
          ) {
            throw stateConflict(
              "Staff must have an active verified account with active MFA"
            );
          }
          const created =
            await transaction.platformStaffRoleAssignment.create({
              data: {
                userId: input.userId,
                roleCode: input.roleCode,
                assignedBy: actorId,
                reason: input.reason
              },
              include: {
                user: {
                  select: { emailDisplay: true, displayName: true }
                }
              }
            });
          await this.audit.record(
            {
              actorId,
              action: "platform_admin.staff_role.assigned",
              resourceType: "platform_staff_role_assignment",
              resourceId: created.id,
              reason: input.reason,
              requestId: context.requestId
            },
            transaction
          );
          return created;
        }
      );
      return roleSummary(assignment);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new DomainError({
          statusCode: 409,
          code: "DUPLICATE",
          message: "This active platform role is already assigned"
        });
      }
      throw error;
    }
  }

  public async revokeStaffRole(
    assignmentId: string,
    version: number,
    input: RevokePlatformStaffRoleInput,
    actorId: string,
    context: RequestContext
  ): Promise<PlatformStaffRoleAssignmentSummary> {
    const assignment = await this.prisma.$transaction(
      async (transaction) => {
        await staffRoleLock(transaction);
        const current =
          await transaction.platformStaffRoleAssignment.findUnique({
            where: { id: assignmentId },
            include: {
              user: {
                select: { emailDisplay: true, displayName: true }
              }
            }
          });
        if (!current) throw notFound();
        if (current.revokedAt) return current;
        if (
          current.roleCode === "SUPER_ADMIN" &&
          (await transaction.platformStaffRoleAssignment.count({
            where: { roleCode: "SUPER_ADMIN", revokedAt: null }
          })) <= 1
        ) {
          throw stateConflict("The last active super administrator cannot be revoked");
        }
        const changed =
          await transaction.platformStaffRoleAssignment.updateMany({
            where: { id: assignmentId, version, revokedAt: null },
            data: {
              revokedAt: new Date(),
              revokedBy: actorId,
              revokeReason: input.reason,
              version: { increment: 1 }
            }
          });
        if (changed.count !== 1) throw versionConflict(current.version);
        await this.audit.record(
          {
            actorId,
            action: "platform_admin.staff_role.revoked",
            resourceType: "platform_staff_role_assignment",
            resourceId: current.id,
            reason: input.reason,
            requestId: context.requestId
          },
          transaction
        );
        return transaction.platformStaffRoleAssignment.findUniqueOrThrow({
          where: { id: assignmentId },
          include: {
            user: {
              select: { emailDisplay: true, displayName: true }
            }
          }
        });
      }
    );
    return roleSummary(assignment);
  }
}

function receiptSummary(
  receipt: NpdReceiptObligation,
  now: Date
): AdminNpdReceiptSummary {
  return {
    id: receipt.id,
    paymentId: receipt.paymentId,
    workspaceId: receipt.workspaceId,
    yookassaPaymentId: receipt.yookassaPaymentId,
    sequence: receipt.sequence,
    grossAmountMinor: safeMinor(receipt.grossAmountMinor),
    currency: "RUB",
    paidAt: receipt.paidAt.toISOString(),
    serviceDescription: receipt.serviceDescriptionSnapshot,
    registrationMode: receipt.registrationMode,
    status: receipt.status,
    ageSeconds: Math.max(
      0,
      Math.floor((now.getTime() - receipt.paidAt.getTime()) / 1_000)
    ),
    deliveryAttempts: receipt.deliveryAttempts,
    ...(receipt.officialReceiptId
      ? { officialReceiptId: receipt.officialReceiptId }
      : {}),
    ...(receipt.officialReceiptUrl
      ? { officialReceiptUrl: receipt.officialReceiptUrl }
      : {}),
    ...(receipt.registeredAt
      ? { registeredAt: receipt.registeredAt.toISOString() }
      : {}),
    ...(receipt.deliveredAt
      ? { deliveredAt: receipt.deliveredAt.toISOString() }
      : {}),
    ...(receipt.cancelledAt
      ? { cancelledAt: receipt.cancelledAt.toISOString() }
      : {}),
    ...(receipt.replacementReceiptId
      ? { replacementReceiptId: receipt.replacementReceiptId }
      : {}),
    version: receipt.version
  };
}

function roleSummary(assignment: {
  readonly id: string;
  readonly userId: string;
  readonly roleCode: PlatformRoleCode;
  readonly reason: string;
  readonly assignedBy: string | null;
  readonly assignedAt: Date;
  readonly revokedAt: Date | null;
  readonly version: number;
  readonly user: {
    readonly emailDisplay: string;
    readonly displayName: string;
  };
}): PlatformStaffRoleAssignmentSummary {
  return {
    id: assignment.id,
    userId: assignment.userId,
    email: assignment.user.emailDisplay,
    displayName: assignment.user.displayName,
    roleCode: assignment.roleCode,
    reason: assignment.reason,
    ...(assignment.assignedBy ? { assignedBy: assignment.assignedBy } : {}),
    assignedAt: assignment.assignedAt.toISOString(),
    ...(assignment.revokedAt
      ? { revokedAt: assignment.revokedAt.toISOString() }
      : {}),
    version: assignment.version
  };
}

async function staffRoleLock(
  transaction: Prisma.TransactionClient
): Promise<void> {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended('platform-staff-role-admin', 0)
    )::text AS lock_result
  `;
}

function safeMinor(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error("Money amount exceeds the safe API range");
  }
  return number;
}

function notFound(): DomainError {
  return new DomainError({
    statusCode: 404,
    code: "NOT_FOUND",
    message: "Resource not found"
  });
}

function stateConflict(message: string): DomainError {
  return new DomainError({
    statusCode: 409,
    code: "RESOURCE_STATE_CONFLICT",
    message
  });
}

function versionConflict(currentVersion: number): DomainError {
  return new DomainError({
    statusCode: 409,
    code: "VERSION_CONFLICT",
    message: "The resource was changed by another request",
    details: { currentVersion }
  });
}
