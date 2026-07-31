import { Inject, Injectable } from "@nestjs/common";
import {
  type BillingBalanceSummary,
  type BillingLedgerTransactionSummary,
  type BillingOrderSummary,
  type BillingPaymentMethodSummary,
  type BillingPlanSummary,
  type BillingRefundSummary,
  type BillingSubscriptionSummary,
  type CreateBillingCheckoutInput,
  type CreateBillingRefundInput,
  type CreateBillingTopUpInput,
  type NpdReceiptObligationSummary
} from "@seo-platform/contracts";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import { AuditService } from "../audit/audit.service.js";
import { DomainError, isUniqueConstraintError } from "../common/domain-error.js";
import { uuidV7 } from "../common/uuid-v7.js";
import type { AppConfig } from "../config/app-config.js";
import { APP_CONFIG } from "../config/config.module.js";
import { PrismaService } from "../database/prisma.service.js";
import type {
  BillingOrderKind,
  BillingPaymentStatus,
  BillingPlanVersion,
  BillingRefundStatus,
  Prisma
} from "../generated/prisma/client.js";
import type { RequestContext } from "../identity/identity.types.js";
import { BillingLedgerService } from "./billing-ledger.service.js";
import { billingPlanFeatures } from "./billing-plan-features.js";
import { BillingPiiService } from "./billing-pii.service.js";
import type { YookassaWebhookInput } from "./billing-input.js";
import { isYookassaWebhookIp } from "./yookassa-webhook-ip.js";
import {
  YookassaClient,
  YookassaProviderError,
  type YookassaPayment,
  type YookassaRefund,
  yookassaMoneyMinor
} from "./yookassa.client.js";

const CURRENCY = "RUB" as const;
const CHECKOUT_INCLUDE = {
  planVersion: { include: { plan: true } },
  payments: { orderBy: { createdAt: "desc" as const }, take: 1 }
} as const;

@Injectable()
export class BillingService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: BillingLedgerService,
    private readonly pii: BillingPiiService,
    private readonly yookassa: YookassaClient,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public async plans(now = new Date()): Promise<readonly BillingPlanSummary[]> {
    const versions = await this.prisma.billingPlanVersion.findMany({
      where: {
        status: "PUBLISHED",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        plan: { status: "ACTIVE" }
      },
      include: { plan: true, prices: true },
      orderBy: [{ plan: { code: "asc" } }, { version: "desc" }]
    });
    const current = new Map<string, (typeof versions)[number]>();
    for (const version of versions) {
      if (!current.has(version.plan.code)) {
        current.set(version.plan.code, version);
      }
    }
    return [...current.values()]
      .map(planSummary)
      .sort(
        (left, right) =>
          planOrder(left.code) - planOrder(right.code)
      );
  }

  public async subscription(
    workspaceId: string
  ): Promise<BillingSubscriptionSummary | null> {
    const subscription =
      await this.prisma.billingSubscription.findUnique({
        where: { workspaceId },
        include: {
          planVersion: { include: { plan: true } },
          defaultPaymentMethod: { select: { status: true } }
        }
      });
    return subscription ? subscriptionSummary(subscription) : null;
  }

  public async cancelSubscription(
    workspaceId: string,
    actorId: string,
    version: number,
    context: RequestContext
  ): Promise<BillingSubscriptionSummary> {
    const existing =
      await this.prisma.billingSubscription.findUnique({
        where: { workspaceId },
        include: {
          planVersion: { include: { plan: true } },
          defaultPaymentMethod: { select: { status: true } }
        }
      });
    if (!existing) throw notFound();
    if (existing.cancelAtPeriodEnd) return subscriptionSummary(existing);
    if (existing.version !== version) {
      throw versionConflict(existing.version);
    }
    if (
      !["TRIALING", "ACTIVE", "PAST_DUE", "GRACE"].includes(
        existing.status
      )
    ) {
      throw new DomainError({
        statusCode: 409,
        code: "RESOURCE_STATE_CONFLICT",
        message: "The subscription cannot be cancelled in its current state"
      });
    }
    const updated = await this.prisma.$transaction(
      async (transaction) => {
        const changed =
          await transaction.billingSubscription.updateMany({
            where: {
              id: existing.id,
              version,
              cancelAtPeriodEnd: false
            },
            data: {
              status: "CANCELLING",
              cancelAtPeriodEnd: true,
              version: { increment: 1 }
            }
          });
        if (changed.count !== 1) {
          const current =
            await transaction.billingSubscription.findUnique({
              where: { id: existing.id },
              select: { version: true }
            });
          throw versionConflict(current?.version ?? version);
        }
        await this.audit.record(
          {
            actorId,
            workspaceId,
            action: "billing.subscription.cancellation_scheduled",
            resourceType: "billing_subscription",
            resourceId: existing.id,
            requestId: context.requestId
          },
          transaction
        );
        return transaction.billingSubscription.findUniqueOrThrow({
          where: { id: existing.id },
          include: {
            planVersion: { include: { plan: true } },
            defaultPaymentMethod: { select: { status: true } }
          }
        });
      }
    );
    return subscriptionSummary(updated);
  }

  public async startTrial(
    workspaceId: string,
    actorId: string,
    idempotencyKey: string,
    context: RequestContext
  ): Promise<BillingSubscriptionSummary> {
    const existing =
      await this.prisma.billingSubscription.findUnique({
        where: { workspaceId },
        include: {
          planVersion: { include: { plan: true } },
          defaultPaymentMethod: { select: { status: true } }
        }
      });
    if (existing) return subscriptionSummary(existing);

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerUserId: true }
    });
    if (!workspace) throw notFound();
    const owner = await this.prisma.user.findUnique({
      where: { id: workspace.ownerUserId },
      select: { id: true, status: true, emailVerifiedAt: true }
    });
    if (
      !owner ||
      owner.status !== "ACTIVE" ||
      !owner.emailVerifiedAt
    ) {
      throw new DomainError({
        statusCode: 409,
        code: "EMAIL_VERIFICATION_REQUIRED",
        message: "Verify the workspace owner email before starting a trial"
      });
    }
    const priorClaim =
      await this.prisma.billingTrialClaim.findUnique({
        where: { ownerUserId: owner.id }
      });
    if (priorClaim) {
      throw trialAlreadyUsed();
    }
    const version = await this.currentPlanVersion("TRIAL", "MONTHLY");
    const now = new Date();
    const trialEnd = addDays(now, version.trialDays);
    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        await transaction.billingTrialClaim.create({
          data: {
            ownerUserId: owner.id,
            workspaceId
          }
        });
        const subscription =
          await transaction.billingSubscription.create({
            data: {
              workspaceId,
              planVersionId: version.id,
              status: "TRIALING",
              period: "MONTHLY",
              currency: CURRENCY,
              startedAt: now,
              currentPeriodStart: now,
              currentPeriodEnd: trialEnd,
              trialEnd
            },
            include: {
              planVersion: { include: { plan: true } },
              defaultPaymentMethod: { select: { status: true } }
            }
          });
        await this.audit.record(
          {
            actorId,
            workspaceId,
            action: "billing.trial.started",
            resourceType: "billing_subscription",
            resourceId: subscription.id,
            requestId: context.requestId
          },
          transaction
        );
        return subscription;
      });
      void idempotencyKey;
      return subscriptionSummary(created);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const replay =
          await this.prisma.billingSubscription.findUnique({
            where: { workspaceId },
            include: {
              planVersion: { include: { plan: true } },
              defaultPaymentMethod: { select: { status: true } }
            }
          });
        if (replay) return subscriptionSummary(replay);
        const claim =
          await this.prisma.billingTrialClaim.findUnique({
            where: { ownerUserId: owner.id }
          });
        if (claim) throw trialAlreadyUsed();
      }
      throw error;
    }
  }

  public async createCheckout(
    workspaceId: string,
    actorId: string,
    idempotencyKey: string,
    input: CreateBillingCheckoutInput,
    context: RequestContext
  ): Promise<BillingOrderSummary> {
    this.assertProviderEnabled();
    const planVersion = await this.currentPlanVersion(
      input.planCode,
      input.period
    );
    const price = planVersion.prices.find(
      (candidate) =>
        candidate.period === input.period &&
        candidate.currency === CURRENCY
    );
    if (!price || price.amountMinor <= 0n) {
      throw new DomainError({
        statusCode: 409,
        code: "RESOURCE_STATE_CONFLICT",
        message: "The selected plan cannot be purchased"
      });
    }
    return this.createOrderAndPayment({
      workspaceId,
      actorId,
      idempotencyKey,
      input,
      context,
      kind: "SUBSCRIPTION",
      amountMinor: price.amountMinor,
      planVersion
    });
  }

  public async createTopUp(
    workspaceId: string,
    actorId: string,
    idempotencyKey: string,
    input: CreateBillingTopUpInput,
    context: RequestContext
  ): Promise<BillingOrderSummary> {
    this.assertProviderEnabled();
    return this.createOrderAndPayment({
      workspaceId,
      actorId,
      idempotencyKey,
      input,
      context,
      kind: "TOP_UP",
      amountMinor: BigInt(input.amountMinor)
    });
  }

  public async refreshOrder(
    workspaceId: string,
    orderId: string
  ): Promise<BillingOrderSummary> {
    const order = await this.orderRecord(workspaceId, orderId);
    const payment = order.payments[0];
    if (
      payment &&
      !terminalPaymentStatus(payment.status)
    ) {
      await this.resumePayment(payment.id);
    }
    return orderSummary(await this.orderRecord(workspaceId, orderId));
  }

  public async listOrders(
    workspaceId: string
  ): Promise<readonly BillingOrderSummary[]> {
    const orders = await this.prisma.billingOrder.findMany({
      where: { workspaceId },
      include: CHECKOUT_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100
    });
    return orders.map(orderSummary);
  }

  public async balance(
    workspaceId: string
  ): Promise<BillingBalanceSummary> {
    const result = await this.prisma.$transaction((transaction) =>
      this.ledger.balance(transaction, workspaceId)
    );
    const prepaidMinor = safeMinor(result.prepaidMinor);
    const includedCreditsMinor = safeMinor(result.includedCreditsMinor);
    return {
      workspaceId,
      currency: CURRENCY,
      prepaidMinor,
      includedCreditsMinor,
      availableMinor: prepaidMinor + includedCreditsMinor,
      ...(result.updatedAt
        ? { updatedAt: result.updatedAt.toISOString() }
        : {})
    };
  }

  public async transactions(
    workspaceId: string
  ): Promise<readonly BillingLedgerTransactionSummary[]> {
    const transactions =
      await this.prisma.billingLedgerTransaction.findMany({
        where: {
          status: "POSTED",
          entries: {
            some: { account: { workspaceId } }
          }
        },
        include: {
          entries: {
            include: { account: { select: { type: true } } },
            orderBy: { createdAt: "asc" }
          }
        },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 100
      });
    return transactions.map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      businessReference: transaction.businessReference,
      description: transaction.description,
      occurredAt: transaction.occurredAt.toISOString(),
      entries: transaction.entries.map((entry) => ({
        accountType: entry.account.type,
        direction: entry.direction,
        amountMinor: safeMinor(entry.amountMinor),
        currency: CURRENCY
      }))
    }));
  }

  public async paymentMethods(
    workspaceId: string
  ): Promise<readonly BillingPaymentMethodSummary[]> {
    const methods = await this.prisma.billingPaymentMethod.findMany({
      where: { workspaceId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }]
    });
    return methods.map(paymentMethodSummary);
  }

  public async disablePaymentMethod(
    workspaceId: string,
    methodId: string,
    actorId: string,
    version: number,
    context: RequestContext
  ): Promise<BillingPaymentMethodSummary> {
    const method = await this.prisma.billingPaymentMethod.findFirst({
      where: { id: methodId, workspaceId }
    });
    if (!method) throw notFound();
    if (method.status === "DISABLED") return paymentMethodSummary(method);
    if (method.version !== version) throw versionConflict(method.version);
    const updated = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.billingPaymentMethod.update({
        where: { id: method.id },
        data: {
          status: "DISABLED",
          disabledAt: new Date(),
          version: { increment: 1 }
        }
      });
      await transaction.billingSubscription.updateMany({
        where: { workspaceId, defaultPaymentMethodId: method.id },
        data: {
          defaultPaymentMethodId: null,
          version: { increment: 1 }
        }
      });
      await this.audit.record(
        {
          actorId,
          workspaceId,
          action: "billing.payment_method.disabled",
          resourceType: "billing_payment_method",
          resourceId: method.id,
          requestId: context.requestId
        },
        transaction
      );
      return result;
    });
    return paymentMethodSummary(updated);
  }

  public async receipts(
    workspaceId: string
  ): Promise<readonly NpdReceiptObligationSummary[]> {
    const receipts = await this.prisma.npdReceiptObligation.findMany({
      where: { workspaceId },
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      take: 100
    });
    return receipts.map(receiptSummary);
  }

  public async createRefund(
    workspaceId: string,
    paymentId: string,
    actorId: string,
    idempotencyKey: string,
    input: CreateBillingRefundInput,
    context: RequestContext
  ): Promise<BillingRefundSummary> {
    this.assertProviderEnabled();
    const requestHash = hashRequest("billing-refund@1", input);
    const replay = await this.prisma.billingRefund.findUnique({
      where: {
        workspaceId_requestIdempotencyKey: {
          workspaceId,
          requestIdempotencyKey: idempotencyKey
        }
      }
    });
    if (replay) {
      assertRequestHash(replay.requestHash, requestHash);
      if (
        replay.status === "CREATING" ||
        replay.status === "FAILED_RETRYABLE"
      ) {
        await this.resumeRefund(replay.id);
      }
      return refundSummary(
        (await this.prisma.billingRefund.findUnique({
          where: { id: replay.id }
        }))!
      );
    }

    const amountMinor = BigInt(input.amountMinor);
    const refundId = uuidV7();
    let refund;
    try {
      refund = await this.serializable(async (transaction) => {
        const payment = await transaction.billingPayment.findFirst({
          where: { id: paymentId, workspaceId },
          include: { order: true }
        });
        if (
          !payment ||
          !["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status) ||
          !payment.externalId
        ) {
          throw new DomainError({
            statusCode: 409,
            code: "RESOURCE_STATE_CONFLICT",
            message: "Only a succeeded payment can be refunded"
          });
        }
        const outstanding =
          await transaction.billingRefund.aggregate({
            where: {
              paymentId,
              status: {
                in: ["CREATING", "PENDING", "FAILED_RETRYABLE"]
              }
            },
            _sum: { amountMinor: true }
          });
        const reservedMinor = outstanding._sum.amountMinor ?? 0n;
        const remaining =
          payment.amountMinor -
          payment.refundedAmountMinor -
          reservedMinor;
        if (amountMinor > remaining) {
          throw new DomainError({
            statusCode: 409,
            code: "RESOURCE_STATE_CONFLICT",
            message: "Refund amount exceeds the unrefunded payment amount",
            details: { remainingMinor: safeMinor(remaining) }
          });
        }
        if (payment.order.kind === "TOP_UP") {
          const available = await this.ledger.balance(
            transaction,
            workspaceId
          );
          const refundable = available.prepaidMinor - reservedMinor;
          if (amountMinor > refundable) {
            throw new DomainError({
              statusCode: 409,
              code: "RESOURCE_STATE_CONFLICT",
              message: "Only unused prepaid balance can be refunded",
              details: {
                refundableMinor: safeMinor(
                  refundable > 0n ? refundable : 0n
                )
              }
            });
          }
        }
        const created = await transaction.billingRefund.create({
          data: {
            id: refundId,
            workspaceId,
            paymentId,
            createdBy: actorId,
            providerIdempotencyKey: refundId,
            requestIdempotencyKey: idempotencyKey,
            requestHash,
            amountMinor,
            currency: CURRENCY,
            reason: input.reason
          }
        });
        await this.audit.record(
          {
            actorId,
            workspaceId,
            action: "billing.refund.requested",
            resourceType: "billing_refund",
            resourceId: created.id,
            outcome: "REQUESTED",
            requestId: context.requestId
          },
          transaction
        );
        return created;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const concurrent = await this.prisma.billingRefund.findUnique({
          where: {
            workspaceId_requestIdempotencyKey: {
              workspaceId,
              requestIdempotencyKey: idempotencyKey
            }
          }
        });
        if (concurrent) {
          assertRequestHash(concurrent.requestHash, requestHash);
          await this.resumeRefund(concurrent.id);
          return refundSummary(
            (await this.prisma.billingRefund.findUnique({
              where: { id: concurrent.id }
            }))!
          );
        }
      }
      throw error;
    }
    await this.resumeRefund(refund.id);
    return refundSummary(
      (await this.prisma.billingRefund.findUnique({
        where: { id: refund.id }
      }))!
    );
  }

  public async processWebhook(
    input: YookassaWebhookInput,
    sourceIp: string
  ): Promise<void> {
    if (
      this.config.billing.yookassa.validateWebhookSourceIp &&
      !isYookassaWebhookIp(sourceIp)
    ) {
      throw new DomainError({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "Webhook source is not allowed"
      });
    }
    let inbox = await this.prisma.billingWebhookInbox.findUnique({
      where: {
        provider_eventFingerprint: {
          provider: "YOOKASSA",
          eventFingerprint: input.fingerprint
        }
      }
    });
    if (!inbox) {
      try {
        inbox = await this.prisma.billingWebhookInbox.create({
          data: {
            provider: "YOOKASSA",
            eventFingerprint: input.fingerprint,
            eventType: input.event,
            objectType: input.objectType,
            objectId: input.objectId,
            payloadHash: input.payloadHash,
            sourceIp
          }
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        inbox = await this.prisma.billingWebhookInbox.findUnique({
          where: {
            provider_eventFingerprint: {
              provider: "YOOKASSA",
              eventFingerprint: input.fingerprint
            }
          }
        });
      }
    }
    if (!inbox) throw new Error("Webhook inbox creation failed");
    if (
      !Buffer.from(inbox.payloadHash).equals(
        Buffer.from(input.payloadHash)
      )
    ) {
      throw new DomainError({
        statusCode: 409,
        code: "IDEMPOTENCY_CONFLICT",
        message: "Webhook replay payload differs"
      });
    }
    if (inbox.status === "PROCESSED") return;
    const claimed = await this.prisma.billingWebhookInbox.updateMany({
      where: {
        id: inbox.id,
        status: {
          in: ["RECEIVED", "FAILED_RETRYABLE"]
        }
      },
      data: {
        status: "PROCESSING",
        attemptCount: { increment: 1 },
        failureCode: null
      }
    });
    if (claimed.count !== 1) {
      throw providerUnavailable("PAYMENT_WEBHOOK_ALREADY_PROCESSING");
    }
    try {
      if (input.objectType === "payment") {
        const payment = await this.yookassa.getPayment(input.objectId);
        await this.applyPayment(payment);
      } else {
        const refund = await this.yookassa.getRefund(input.objectId);
        await this.applyRefund(refund);
      }
      await this.prisma.billingWebhookInbox.update({
        where: { id: inbox.id },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
          failureCode: null
        }
      });
    } catch (error) {
      const retryable =
        error instanceof YookassaProviderError
          ? error.retryable
          : error instanceof DomainError
            ? error.retryable
            : true;
      await this.prisma.billingWebhookInbox.update({
        where: { id: inbox.id },
        data: {
          status: retryable ? "FAILED_RETRYABLE" : "FAILED_FINAL",
          failureCode: publicFailureCode(error)
        }
      });
      throw error;
    }
  }

  public async reconcilePending(batchSize: number): Promise<number> {
    if (!this.yookassa.isEnabled()) return 0;
    const payments = await this.prisma.billingPayment.findMany({
      where: {
        status: {
          in: ["CREATING", "PENDING", "FAILED_RETRYABLE"]
        }
      },
      orderBy: { updatedAt: "asc" },
      take: batchSize,
      select: { id: true }
    });
    const refunds = await this.prisma.billingRefund.findMany({
      where: {
        status: {
          in: ["CREATING", "PENDING", "FAILED_RETRYABLE"]
        }
      },
      orderBy: { updatedAt: "asc" },
      take: Math.max(0, batchSize - payments.length),
      select: { id: true }
    });
    let processed = 0;
    for (const payment of payments) {
      try {
        await this.resumePayment(payment.id);
        processed += 1;
      } catch {
        // A later bounded reconciliation cycle retries the same provider key.
      }
    }
    for (const refund of refunds) {
      try {
        await this.resumeRefund(refund.id);
        processed += 1;
      } catch {
        // A later bounded reconciliation cycle retries the same provider key.
      }
    }
    return processed;
  }

  public async reconcileSubscriptions(
    batchSize: number,
    now = new Date()
  ): Promise<number> {
    const subscriptions =
      await this.prisma.billingSubscription.findMany({
        where: {
          status: {
            in: [
              "TRIALING",
              "ACTIVE",
              "PAST_DUE",
              "GRACE",
              "CANCELLING"
            ]
          },
          currentPeriodEnd: { lte: now }
        },
        include: {
          workspace: {
            select: { ownerUserId: true, status: true }
          },
          planVersion: {
            include: { prices: true }
          },
          defaultPaymentMethod: true
        },
        orderBy: [{ currentPeriodEnd: "asc" }, { id: "asc" }],
        take: batchSize
      });
    let processed = 0;
    for (const subscription of subscriptions) {
      if (
        subscription.graceEnd &&
        subscription.graceEnd <= now
      ) {
        await this.restrictExpiredSubscription(subscription.id, now);
        processed += 1;
        continue;
      }
      const method = subscription.defaultPaymentMethod;
      if (
        subscription.status === "GRACE" &&
        subscription.graceEnd &&
        subscription.graceEnd > now &&
        (!method || method.status !== "ACTIVE")
      ) {
        processed += 1;
        continue;
      }
      if (
        subscription.status === "TRIALING" ||
        subscription.status === "CANCELLING" ||
        subscription.cancelAtPeriodEnd ||
        !method ||
        method.status !== "ACTIVE"
      ) {
        await this.restrictExpiredSubscription(subscription.id, now);
        processed += 1;
        continue;
      }
      if (subscription.status === "PAST_DUE") {
        await this.prisma.billingSubscription.updateMany({
          where: { id: subscription.id, status: "PAST_DUE" },
          data: { status: "GRACE", version: { increment: 1 } }
        });
      }
      try {
        await this.createOrResumeRenewal(subscription, now);
      } catch {
        await this.markRenewalPastDue(subscription.id, now);
      }
      processed += 1;
    }
    return processed;
  }

  private async createOrderAndPayment(input: {
    readonly workspaceId: string;
    readonly actorId: string;
    readonly idempotencyKey: string;
    readonly input: CreateBillingCheckoutInput | CreateBillingTopUpInput;
    readonly context: RequestContext;
    readonly kind: BillingOrderKind;
    readonly amountMinor: bigint;
    readonly planVersion?: BillingPlanVersion & {
      readonly serviceDescription: string;
    };
  }): Promise<BillingOrderSummary> {
    const requestHash = hashRequest("billing-order@1", {
      kind: input.kind,
      body: input.input
    });
    const replay = await this.prisma.billingOrder.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: input.workspaceId,
          idempotencyKey: input.idempotencyKey
        }
      },
      include: CHECKOUT_INCLUDE
    });
    if (replay) {
      assertRequestHash(replay.requestHash, requestHash);
      const payment = replay.payments[0];
      if (
        payment &&
        (payment.status === "CREATING" ||
          payment.status === "FAILED_RETRYABLE")
      ) {
        await this.resumePayment(payment.id);
      }
      return orderSummary(
        await this.orderRecord(input.workspaceId, replay.id)
      );
    }

    const orderId = uuidV7();
    const paymentId = uuidV7();
    const description =
      input.kind === "SUBSCRIPTION"
        ? input.planVersion!.serviceDescription
        : "Пополнение баланса системных SEO API";
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.billingOrder.create({
          data: {
            id: orderId,
            workspaceId: input.workspaceId,
            createdBy: input.actorId,
            kind: input.kind,
            ...(input.planVersion
              ? {
                  planVersionId: input.planVersion.id,
                  period: (
                    input.input as CreateBillingCheckoutInput
                  ).period
                }
              : {}),
            amountMinor: input.amountMinor,
            currency: CURRENCY,
            serviceDescriptionSnapshot: description,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            termsVersion: input.input.termsVersion,
            termsAcceptedAt: new Date(),
            savePaymentMethod: input.input.savePaymentMethod,
            buyerType: input.input.buyerType,
            ...(input.input.buyerName
              ? {
                  buyerNameEncrypted: this.pii.seal(
                    input.input.buyerName,
                    `order:${orderId}:buyer-name`
                  )
                }
              : {}),
            ...(input.input.buyerInn
              ? {
                  buyerInnEncrypted: this.pii.seal(
                    input.input.buyerInn,
                    `order:${orderId}:buyer-inn`
                  )
                }
              : {}),
            deliveryEmailEncrypted: this.pii.seal(
              input.input.deliveryEmail,
              `order:${orderId}:delivery-email`
            )
          }
        });
        await transaction.billingPayment.create({
          data: {
            id: paymentId,
            workspaceId: input.workspaceId,
            orderId,
            provider: "YOOKASSA",
            providerIdempotencyKey: paymentId,
            amountMinor: input.amountMinor,
            currency: CURRENCY
          }
        });
        await this.audit.record(
          {
            actorId: input.actorId,
            workspaceId: input.workspaceId,
            action: "billing.checkout.created",
            resourceType: "billing_order",
            resourceId: orderId,
            outcome: "REQUESTED",
            requestId: input.context.requestId
          },
          transaction
        );
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const concurrent = await this.prisma.billingOrder.findUnique({
          where: {
            workspaceId_idempotencyKey: {
              workspaceId: input.workspaceId,
              idempotencyKey: input.idempotencyKey
            }
          },
          include: CHECKOUT_INCLUDE
        });
        if (concurrent) {
          assertRequestHash(concurrent.requestHash, requestHash);
          const concurrentPayment = concurrent.payments[0];
          if (concurrentPayment) {
            await this.resumePayment(concurrentPayment.id);
          }
          return orderSummary(
            await this.orderRecord(input.workspaceId, concurrent.id)
          );
        }
      }
      throw error;
    }
    await this.resumePayment(paymentId);
    return orderSummary(await this.orderRecord(input.workspaceId, orderId));
  }

  private async createOrResumeRenewal(
    subscription: Prisma.BillingSubscriptionGetPayload<{
      include: {
        workspace: { select: { ownerUserId: true; status: true } };
        planVersion: { include: { prices: true } };
        defaultPaymentMethod: true;
      };
    }>,
    now: Date
  ): Promise<void> {
    const method = subscription.defaultPaymentMethod;
    if (!method || method.status !== "ACTIVE") {
      throw new Error("Active recurring payment method is missing");
    }
    const idempotencyKey =
      `billing-renewal:${subscription.id}:` +
      subscription.currentPeriodEnd.getTime();
    const existing = await this.prisma.billingOrder.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: subscription.workspaceId,
          idempotencyKey
        }
      },
      include: CHECKOUT_INCLUDE
    });
    if (existing) {
      const payment = existing.payments[0];
      if (!payment) throw new Error("Renewal payment is missing");
      if (!terminalPaymentStatus(payment.status)) {
        await this.resumePayment(payment.id);
      }
      const refreshed = await this.prisma.billingPayment.findUnique({
        where: { id: payment.id },
        select: { status: true }
      });
      if (!refreshed || refreshed.status !== "SUCCEEDED") {
        throw new Error("Recurring payment has not succeeded");
      }
      return;
    }

    const price = subscription.planVersion.prices.find(
      (candidate) =>
        candidate.period === subscription.period &&
        candidate.currency === CURRENCY
    );
    if (!price || price.amountMinor <= 0n) {
      throw new Error("Renewal price is unavailable");
    }
    const sourcePayment = await this.prisma.billingPayment.findFirst({
      where: {
        workspaceId: subscription.workspaceId,
        paymentMethodRecordId: method.id,
        status: {
          in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"]
        }
      },
      include: { order: true },
      orderBy: [{ succeededAt: "desc" }, { id: "desc" }]
    });
    if (!sourcePayment) {
      throw new Error("Recurring payment consent source is missing");
    }
    const orderId = uuidV7();
    const paymentId = uuidV7();
    const requestHash = hashRequest("billing-renewal@1", {
      subscriptionId: subscription.id,
      periodStart: subscription.currentPeriodEnd.toISOString(),
      planVersionId: subscription.planVersionId,
      amountMinor: price.amountMinor.toString()
    });
    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.billingOrder.create({
          data: {
            id: orderId,
            workspaceId: subscription.workspaceId,
            createdBy:
              sourcePayment.order.createdBy ??
              subscription.workspace.ownerUserId,
            kind: "SUBSCRIPTION",
            planVersionId: subscription.planVersionId,
            period: subscription.period,
            amountMinor: price.amountMinor,
            currency: CURRENCY,
            serviceDescriptionSnapshot:
              subscription.planVersion.serviceDescription,
            idempotencyKey,
            requestHash,
            termsVersion: sourcePayment.order.termsVersion,
            termsAcceptedAt: sourcePayment.order.termsAcceptedAt,
            savePaymentMethod: false,
            buyerType: sourcePayment.order.buyerType,
            ...(sourcePayment.order.buyerNameEncrypted
              ? {
                  buyerNameEncrypted:
                    sourcePayment.order.buyerNameEncrypted
                }
              : {}),
            ...(sourcePayment.order.buyerInnEncrypted
              ? {
                  buyerInnEncrypted:
                    sourcePayment.order.buyerInnEncrypted
                }
              : {}),
            deliveryEmailEncrypted:
              sourcePayment.order.deliveryEmailEncrypted
          }
        });
        await transaction.billingPayment.create({
          data: {
            id: paymentId,
            workspaceId: subscription.workspaceId,
            orderId,
            provider: "YOOKASSA",
            providerIdempotencyKey: paymentId,
            paymentMethodRecordId: method.id,
            paymentMethodType: method.type,
            amountMinor: price.amountMinor,
            currency: CURRENCY
          }
        });
        await this.audit.record(
          {
            actorId: subscription.workspace.ownerUserId,
            workspaceId: subscription.workspaceId,
            action: "billing.renewal.created",
            resourceType: "billing_order",
            resourceId: orderId,
            outcome: "REQUESTED",
            requestId: `billing-renewal-${subscription.id}-${now.getTime()}`
          },
          transaction
        );
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const concurrent = await this.prisma.billingOrder.findUnique({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: subscription.workspaceId,
            idempotencyKey
          }
        },
        include: CHECKOUT_INCLUDE
      });
      const concurrentPayment = concurrent?.payments[0];
      if (!concurrentPayment) throw error;
      await this.resumePayment(concurrentPayment.id);
      return;
    }
    await this.resumePayment(paymentId);
  }

  private async resumePayment(paymentId: string): Promise<void> {
    const payment = await this.prisma.billingPayment.findUnique({
      where: { id: paymentId },
      include: { order: true, paymentMethod: true }
    });
    if (!payment || terminalPaymentStatus(payment.status)) return;
    try {
      if (
        payment.paymentMethodRecordId &&
        payment.paymentMethod?.status !== "ACTIVE"
      ) {
        throw new YookassaProviderError(
          "PAYMENT_METHOD_DISABLED",
          false
        );
      }
      const providerPayment = payment.externalId
        ? await this.yookassa.getPayment(payment.externalId)
        : await this.yookassa.createPayment({
            idempotencyKey: payment.providerIdempotencyKey,
            amountMinor: safeMinor(payment.amountMinor),
            description: payment.order.serviceDescriptionSnapshot.slice(
              0,
              128
            ),
            ...(payment.paymentMethod
              ? {
                  paymentMethodId:
                    payment.paymentMethod.externalId
                }
              : { returnUrl: requiredReturnUrl(this.config) }),
            orderId: payment.orderId,
            workspaceId: payment.workspaceId,
            savePaymentMethod: payment.order.savePaymentMethod
          });
      await this.applyPayment(providerPayment, payment.id);
    } catch (error) {
      await this.paymentProviderFailure(payment.id, payment.orderId, error);
      throw mapProviderError(error);
    }
  }

  private async applyPayment(
    providerPayment: YookassaPayment,
    expectedPaymentId?: string
  ): Promise<void> {
    const orderId = providerPayment.metadata.order_id;
    const workspaceId = providerPayment.metadata.workspace_id;
    if (!orderId || !workspaceId) {
      throw new YookassaProviderError(
        "PAYMENT_PROVIDER_METADATA_MISMATCH",
        false
      );
    }
    const payment = expectedPaymentId
      ? await this.prisma.billingPayment.findUnique({
          where: { id: expectedPaymentId },
          include: {
            order: { include: { planVersion: true } }
          }
        })
      : await this.prisma.billingPayment.findFirst({
          where: {
            OR: [
              { externalId: providerPayment.id },
              { orderId }
            ]
          },
          include: {
            order: { include: { planVersion: true } }
          }
        });
    if (
      !payment ||
      payment.orderId !== orderId ||
      payment.workspaceId !== workspaceId ||
      (payment.externalId && payment.externalId !== providerPayment.id) ||
      yookassaMoneyMinor(providerPayment.amount) !==
        safeMinor(payment.amountMinor) ||
      providerPayment.amount.currency !== CURRENCY
    ) {
      throw new YookassaProviderError(
        "PAYMENT_PROVIDER_OBJECT_MISMATCH",
        false
      );
    }
    const status = providerPaymentStatus(providerPayment.status);
    const now = new Date();
    await this.serializable(async (transaction) => {
      const current = await transaction.billingPayment.findUnique({
        where: { id: payment.id },
        include: {
          order: { include: { planVersion: true } }
        }
      });
      if (!current) throw notFound();
      if (
        current.status === "SUCCEEDED" &&
        status === "SUCCEEDED"
      ) {
        return;
      }
      if (
        terminalPaymentStatus(current.status) &&
        current.status !== status
      ) {
        throw new YookassaProviderError(
          "PAYMENT_PROVIDER_ILLEGAL_STATUS_REGRESSION",
          false
        );
      }
      const paymentMethodId = await this.savePaymentMethod(
        transaction,
        current.workspaceId,
        current.order.savePaymentMethod,
        current.order.termsAcceptedAt,
        providerPayment
      );
      const succeededAt =
        status === "SUCCEEDED"
          ? new Date(
              providerPayment.capturedAt ??
                providerPayment.createdAt
            )
          : undefined;
      await transaction.billingPayment.update({
        where: { id: current.id },
        data: {
          externalId: providerPayment.id,
          status,
          confirmationUrl: providerPayment.confirmationUrl ?? null,
          paymentMethodType: providerPayment.paymentMethod?.type ?? null,
          ...(paymentMethodId
            ? { paymentMethodRecordId: paymentMethodId }
            : {}),
          providerObjectHash: providerPayment.objectHash,
          providerCreatedAt: new Date(providerPayment.createdAt),
          verifiedAt: now,
          ...(succeededAt ? { succeededAt } : {}),
          ...(status === "CANCELED" ? { canceledAt: now } : {}),
          failureCode:
            status === "CANCELED"
              ? providerPayment.cancellationReason ?? "PAYMENT_CANCELED"
              : null,
          version: { increment: 1 }
        }
      });
      if (status === "SUCCEEDED" && succeededAt) {
        await this.settleSucceededPayment(
          transaction,
          current,
          providerPayment.id,
          succeededAt,
          paymentMethodId
        );
      } else {
        await transaction.billingOrder.update({
          where: { id: current.orderId },
          data: {
            status:
              status === "CANCELED"
                ? "CANCELLED"
                : "PROVIDER_PENDING",
            ...(status === "CANCELED"
              ? { completedAt: now }
              : {}),
            version: { increment: 1 }
          }
        });
      }
    });
  }

  private async settleSucceededPayment(
    transaction: Prisma.TransactionClient,
    payment: Prisma.BillingPaymentGetPayload<{
      include: { order: { include: { planVersion: true } } };
    }>,
    externalId: string,
    succeededAt: Date,
    paymentMethodId?: string
  ): Promise<void> {
    const order = payment.order;
    await this.ledger.post(transaction, {
      type:
        order.kind === "TOP_UP" ? "TOP_UP" : "SUBSCRIPTION_PAYMENT",
      businessReference: `yookassa:payment:${externalId}`,
      description: order.serviceDescriptionSnapshot,
      occurredAt: succeededAt,
      createdBy: order.createdBy,
      metadata: {
        provider: "YOOKASSA",
        paymentId: payment.id,
        orderId: order.id,
        workspaceId: order.workspaceId
      },
      entries:
        order.kind === "TOP_UP"
          ? [
              {
                accountType: "PAYMENT_CLEARING",
                direction: "DEBIT",
                amountMinor: payment.amountMinor
              },
              {
                workspaceId: order.workspaceId,
                accountType: "CUSTOMER_PREPAID_LIABILITY",
                direction: "CREDIT",
                amountMinor: payment.amountMinor
              }
            ]
          : [
              {
                accountType: "PAYMENT_CLEARING",
                direction: "DEBIT",
                amountMinor: payment.amountMinor
              },
              {
                accountType: "PLATFORM_REVENUE",
                direction: "CREDIT",
                amountMinor: payment.amountMinor
              }
            ]
    });
    if (order.kind === "SUBSCRIPTION" && order.planVersion) {
      const period = order.period ?? "MONTHLY";
      const periodEnd = addPeriod(succeededAt, period);
      await this.expirePromotionalCredits(
        transaction,
        order.workspaceId,
        `included-credit-expire:payment:${payment.id}`,
        succeededAt,
        order.createdBy
      );
      await transaction.billingSubscription.upsert({
        where: { workspaceId: order.workspaceId },
        create: {
          workspaceId: order.workspaceId,
          planVersionId: order.planVersion.id,
          status: "ACTIVE",
          period,
          currency: CURRENCY,
          startedAt: succeededAt,
          currentPeriodStart: succeededAt,
          currentPeriodEnd: periodEnd,
          provider: "YOOKASSA",
          ...(paymentMethodId
            ? { defaultPaymentMethodId: paymentMethodId }
            : {})
        },
        update: {
          planVersionId: order.planVersion.id,
          status: "ACTIVE",
          period,
          currency: CURRENCY,
          currentPeriodStart: succeededAt,
          currentPeriodEnd: periodEnd,
          trialEnd: null,
          graceEnd: null,
          cancelAtPeriodEnd: false,
          provider: "YOOKASSA",
          ...(paymentMethodId
            ? { defaultPaymentMethodId: paymentMethodId }
            : {}),
          version: { increment: 1 }
        }
      });
      await transaction.workspace.updateMany({
        where: { id: order.workspaceId, status: "READ_ONLY" },
        data: { status: "ACTIVE", version: { increment: 1 } }
      });
      if (order.planVersion.includedDataCreditsMinor > 0n) {
        await this.ledger.post(transaction, {
          type: "INCLUDED_CREDIT_GRANT",
          businessReference: `included-credit:payment:${payment.id}`,
          description: `Included data credits: ${order.serviceDescriptionSnapshot}`,
          occurredAt: succeededAt,
          metadata: {
            paymentId: payment.id,
            orderId: order.id,
            planVersionId: order.planVersion.id,
            expiresAt: periodEnd.toISOString()
          },
          entries: [
            {
              accountType: "PROMOTIONAL_EXPENSE",
              direction: "DEBIT",
              amountMinor: order.planVersion.includedDataCreditsMinor
            },
            {
              workspaceId: order.workspaceId,
              accountType: "PROMOTIONAL_LIABILITY",
              direction: "CREDIT",
              amountMinor: order.planVersion.includedDataCreditsMinor
            }
          ]
        });
      }
    }
    await transaction.npdReceiptObligation.upsert({
      where: { paymentId: payment.id },
      create: {
        paymentId: payment.id,
        yookassaPaymentId: externalId,
        workspaceId: order.workspaceId,
        grossAmountMinor: payment.amountMinor,
        currency: CURRENCY,
        paidAt: succeededAt,
        serviceDescriptionSnapshot: order.serviceDescriptionSnapshot,
        buyerType: order.buyerType,
        ...(order.buyerNameEncrypted
          ? { buyerNameEncrypted: order.buyerNameEncrypted }
          : {}),
        ...(order.buyerInnEncrypted
          ? { buyerInnEncrypted: order.buyerInnEncrypted }
          : {}),
        deliveryEmailEncrypted: order.deliveryEmailEncrypted,
        status: "AWAITING_MANUAL_REGISTRATION"
      },
      update: {}
    });
    await transaction.billingOrder.update({
      where: { id: order.id },
      data: {
        status: "SUCCEEDED",
        completedAt: succeededAt,
        version: { increment: 1 }
      }
    });
    await this.audit.record(
      {
        actorId: order.createdBy,
        workspaceId: order.workspaceId,
        action: "billing.payment.succeeded",
        resourceType: "billing_payment",
        resourceId: payment.id,
        requestId: `billing-payment-${payment.id}`
      },
      transaction
    );
  }

  private async savePaymentMethod(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    consented: boolean,
    consentedAt: Date,
    payment: YookassaPayment
  ): Promise<string | undefined> {
    const method = payment.paymentMethod;
    if (!consented || !method?.saved || !method.id) return undefined;
    const saved = await transaction.billingPaymentMethod.upsert({
      where: {
        provider_externalId: {
          provider: "YOOKASSA",
          externalId: method.id
        }
      },
      create: {
        workspaceId,
        provider: "YOOKASSA",
        externalId: method.id,
        type: method.type,
        ...(method.title ? { title: method.title } : {}),
        consentedAt
      },
      update: {
        type: method.type,
        ...(method.title ? { title: method.title } : {}),
        status: "ACTIVE",
        disabledAt: null,
        version: { increment: 1 }
      }
    });
    if (saved.workspaceId !== workspaceId) {
      throw new YookassaProviderError(
        "PAYMENT_METHOD_TENANT_MISMATCH",
        false
      );
    }
    return saved.id;
  }

  private async paymentProviderFailure(
    paymentId: string,
    orderId: string,
    error: unknown
  ): Promise<void> {
    if (!(error instanceof YookassaProviderError)) return;
    await this.prisma.$transaction([
      this.prisma.billingPayment.update({
        where: { id: paymentId },
        data: {
          status: error.retryable ? "FAILED_RETRYABLE" : "FAILED_FINAL",
          failureCode: error.code,
          version: { increment: 1 }
        }
      }),
      ...(error.retryable
        ? []
        : [
            this.prisma.billingOrder.update({
              where: { id: orderId },
              data: {
                status: "FAILED",
                completedAt: new Date(),
                version: { increment: 1 }
              }
            })
          ])
    ]);
  }

  private async resumeRefund(refundId: string): Promise<void> {
    const refund = await this.prisma.billingRefund.findUnique({
      where: { id: refundId },
      include: { payment: true }
    });
    if (!refund || terminalRefundStatus(refund.status)) return;
    if (!refund.payment.externalId) {
      throw new Error("Refund payment does not have a provider ID");
    }
    try {
      const providerRefund = refund.externalId
        ? await this.yookassa.getRefund(refund.externalId)
        : await this.yookassa.createRefund({
            idempotencyKey: refund.providerIdempotencyKey,
            paymentId: refund.payment.externalId,
            amountMinor: safeMinor(refund.amountMinor),
            description: refund.reason.slice(0, 128),
            refundId: refund.id
          });
      await this.applyRefund(providerRefund, refund.id);
    } catch (error) {
      if (error instanceof YookassaProviderError) {
        await this.prisma.billingRefund.update({
          where: { id: refund.id },
          data: {
            status: error.retryable
              ? "FAILED_RETRYABLE"
              : "FAILED_FINAL",
            failureCode: error.code
          }
        });
      }
      throw mapProviderError(error);
    }
  }

  private async applyRefund(
    providerRefund: YookassaRefund,
    expectedRefundId?: string
  ): Promise<void> {
    const metadataRefundId = providerRefund.metadata.refund_id;
    const refund = expectedRefundId
      ? await this.prisma.billingRefund.findUnique({
          where: { id: expectedRefundId },
          include: { payment: { include: { order: true } } }
        })
      : await this.prisma.billingRefund.findFirst({
          where: {
            OR: [
              { externalId: providerRefund.id },
              ...(metadataRefundId ? [{ id: metadataRefundId }] : [])
            ]
          },
          include: { payment: { include: { order: true } } }
        });
    if (
      !refund ||
      refund.payment.externalId !== providerRefund.paymentId ||
      (refund.externalId && refund.externalId !== providerRefund.id) ||
      yookassaMoneyMinor(providerRefund.amount) !==
        safeMinor(refund.amountMinor) ||
      providerRefund.amount.currency !== CURRENCY
    ) {
      throw new YookassaProviderError(
        "PAYMENT_REFUND_OBJECT_MISMATCH",
        false
      );
    }
    const status = providerRefundStatus(providerRefund.status);
    await this.serializable(async (transaction) => {
      const current = await transaction.billingRefund.findUnique({
        where: { id: refund.id },
        include: { payment: { include: { order: true } } }
      });
      if (!current) throw notFound();
      if (current.status === "SUCCEEDED" && status === "SUCCEEDED") return;
      if (
        terminalRefundStatus(current.status) &&
        current.status !== status
      ) {
        throw new YookassaProviderError(
          "PAYMENT_REFUND_ILLEGAL_STATUS_REGRESSION",
          false
        );
      }
      const succeededAt =
        status === "SUCCEEDED"
          ? new Date(providerRefund.createdAt)
          : undefined;
      await transaction.billingRefund.update({
        where: { id: current.id },
        data: {
          externalId: providerRefund.id,
          status,
          providerObjectHash: providerRefund.objectHash,
          ...(succeededAt ? { succeededAt } : {}),
          failureCode:
            status === "CANCELED"
              ? providerRefund.cancellationReason ?? "REFUND_CANCELED"
              : null
        }
      });
      if (status !== "SUCCEEDED" || !succeededAt) return;
      const refundedTotal =
        current.payment.refundedAmountMinor + current.amountMinor;
      if (refundedTotal > current.payment.amountMinor) {
        throw new Error("Refund total exceeds payment amount");
      }
      const fullyRefunded =
        refundedTotal === current.payment.amountMinor;
      await this.ledger.post(transaction, {
        type: "REFUND",
        businessReference: `yookassa:refund:${providerRefund.id}`,
        description: current.reason,
        occurredAt: succeededAt,
        createdBy: current.createdBy,
        metadata: {
          provider: "YOOKASSA",
          refundId: current.id,
          paymentId: current.paymentId,
          orderId: current.payment.orderId
        },
        entries:
          current.payment.order.kind === "TOP_UP"
            ? [
                {
                  workspaceId: current.workspaceId,
                  accountType: "CUSTOMER_PREPAID_LIABILITY",
                  direction: "DEBIT",
                  amountMinor: current.amountMinor
                },
                {
                  accountType: "PAYMENT_CLEARING",
                  direction: "CREDIT",
                  amountMinor: current.amountMinor
                }
              ]
            : [
                {
                  accountType: "REFUNDS",
                  direction: "DEBIT",
                  amountMinor: current.amountMinor
                },
                {
                  accountType: "PAYMENT_CLEARING",
                  direction: "CREDIT",
                  amountMinor: current.amountMinor
                }
              ]
      });
      await transaction.billingPayment.update({
        where: { id: current.paymentId },
        data: {
          refundedAmountMinor: refundedTotal,
          status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
          version: { increment: 1 }
        }
      });
      await transaction.billingOrder.update({
        where: { id: current.payment.orderId },
        data: {
          status: fullyRefunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
          version: { increment: 1 }
        }
      });
      await transaction.npdReceiptObligation.updateMany({
        where: { paymentId: current.paymentId },
        data: {
          status: fullyRefunded
            ? "CANCELLATION_PENDING"
            : "REPLACEMENT_REQUIRED",
          cancellationReason: current.reason,
          version: { increment: 1 }
        }
      });
      await this.audit.record(
        {
          actorId: current.createdBy,
          workspaceId: current.workspaceId,
          action: "billing.refund.succeeded",
          resourceType: "billing_refund",
          resourceId: current.id,
          requestId: `billing-refund-${current.id}`
        },
        transaction
      );
    });
  }

  private async markRenewalPastDue(
    subscriptionId: string,
    now: Date
  ): Promise<void> {
    const subscription =
      await this.prisma.billingSubscription.findUnique({
        where: { id: subscriptionId },
        select: {
          status: true,
          graceEnd: true,
          currentPeriodEnd: true
        }
      });
    if (
      !subscription ||
      subscription.currentPeriodEnd > now ||
      subscription.status === "SUSPENDED" ||
      subscription.status === "CANCELLED"
    ) {
      return;
    }
    await this.prisma.billingSubscription.updateMany({
      where: {
        id: subscriptionId,
        currentPeriodEnd: { lte: now },
        status: { in: ["ACTIVE", "PAST_DUE", "GRACE"] }
      },
      data: {
        status:
          subscription.status === "GRACE" ? "GRACE" : "PAST_DUE",
        graceEnd: subscription.graceEnd ?? addDays(now, 3),
        version: { increment: 1 }
      }
    });
  }

  private async restrictExpiredSubscription(
    subscriptionId: string,
    now: Date
  ): Promise<void> {
    await this.serializable(async (transaction) => {
      const subscription =
        await transaction.billingSubscription.findUnique({
          where: { id: subscriptionId },
          include: { workspace: { select: { ownerUserId: true } } }
        });
      if (
        !subscription ||
        subscription.currentPeriodEnd > now ||
        subscription.status === "SUSPENDED" ||
        subscription.status === "CANCELLED"
      ) {
        return;
      }
      const trialGraceEnd =
        subscription.status === "TRIALING"
          ? addDays(subscription.currentPeriodEnd, 14)
          : undefined;
      const graceEnd = subscription.graceEnd ?? trialGraceEnd;
      const graceStillActive = Boolean(graceEnd && graceEnd > now);
      const status =
        subscription.cancelAtPeriodEnd ||
        subscription.status === "CANCELLING"
          ? "CANCELLED"
          : graceStillActive
            ? "GRACE"
            : "SUSPENDED";
      await this.expirePromotionalCredits(
        transaction,
        subscription.workspaceId,
        `included-credit-expire:subscription:${subscription.id}:${subscription.currentPeriodEnd.toISOString()}`,
        now,
        subscription.workspace.ownerUserId
      );
      await transaction.billingSubscription.update({
        where: { id: subscription.id },
        data: {
          status,
          ...(graceEnd ? { graceEnd } : {}),
          version: { increment: 1 }
        }
      });
      await transaction.workspace.updateMany({
        where: {
          id: subscription.workspaceId,
          status: "ACTIVE"
        },
        data: { status: "READ_ONLY", version: { increment: 1 } }
      });
      await this.audit.record(
        {
          actorId: subscription.workspace.ownerUserId,
          workspaceId: subscription.workspaceId,
          action: "billing.subscription.restricted",
          resourceType: "billing_subscription",
          resourceId: subscription.id,
          outcome: status,
          requestId: `billing-restriction-${subscription.id}-${subscription.currentPeriodEnd.getTime()}`
        },
        transaction
      );
    });
  }

  private async expirePromotionalCredits(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    businessReference: string,
    occurredAt: Date,
    actorId: string
  ): Promise<void> {
    const balance = await this.ledger.balance(transaction, workspaceId);
    if (balance.includedCreditsMinor <= 0n) return;
    await this.ledger.post(transaction, {
      type: "PROMO_EXPIRATION",
      businessReference,
      description: "Expiration of non-rollover included data credits",
      occurredAt,
      createdBy: actorId,
      metadata: { workspaceId },
      entries: [
        {
          workspaceId,
          accountType: "PROMOTIONAL_LIABILITY",
          direction: "DEBIT",
          amountMinor: balance.includedCreditsMinor
        },
        {
          accountType: "PROMOTIONAL_EXPENSE",
          direction: "CREDIT",
          amountMinor: balance.includedCreditsMinor
        }
      ]
    });
  }

  private async currentPlanVersion(
    code: string,
    period: "MONTHLY" | "ANNUAL"
  ) {
    const now = new Date();
    const version = await this.prisma.billingPlanVersion.findFirst({
      where: {
        status: "PUBLISHED",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        plan: { code, status: "ACTIVE" },
        prices: { some: { period, currency: CURRENCY } }
      },
      include: { plan: true, prices: true },
      orderBy: { version: "desc" }
    });
    if (!version) throw notFound();
    return version;
  }

  private async orderRecord(workspaceId: string, orderId: string) {
    const order = await this.prisma.billingOrder.findFirst({
      where: { id: orderId, workspaceId },
      include: CHECKOUT_INCLUDE
    });
    if (!order || order.payments.length !== 1) throw notFound();
    return order;
  }

  private async serializable<Result>(
    operation: (transaction: Prisma.TransactionClient) => Promise<Result>
  ): Promise<Result> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: "Serializable",
          timeout: 15_000
        });
      } catch (error) {
        if (!isRetryableTransactionError(error) || attempt === 3) {
          throw error;
        }
      }
    }
    throw new Error("Serializable billing transaction retry exhausted");
  }

  private assertProviderEnabled(): void {
    if (!this.yookassa.isEnabled()) {
      throw new DomainError({
        statusCode: 503,
        code: "FEATURE_NOT_AVAILABLE",
        message: "Online payment is not configured",
        details: { provider: "YOOKASSA" }
      });
    }
  }
}

function planSummary(
  version: Prisma.BillingPlanVersionGetPayload<{
    include: { plan: true; prices: true };
  }>
): BillingPlanSummary {
  return {
    code: version.plan.code,
    version: version.version,
    name: version.plan.nameRu,
    description: version.plan.descriptionRu,
    trialDays: version.trialDays,
    includedDataCreditsMinor: safeMinor(
      version.includedDataCreditsMinor
    ),
    serviceDescription: version.serviceDescription,
    features: billingPlanFeatures(version.features),
    prices: version.prices
      .map((price) => ({
        period: price.period,
        currency: CURRENCY,
        amountMinor: safeMinor(price.amountMinor)
      }))
      .sort((left, right) => left.amountMinor - right.amountMinor),
    effectiveFrom: version.effectiveFrom.toISOString()
  };
}

function subscriptionSummary(
  subscription: Prisma.BillingSubscriptionGetPayload<{
    include: {
      planVersion: { include: { plan: true } };
      defaultPaymentMethod: { select: { status: true } };
    };
  }>
): BillingSubscriptionSummary {
  return {
    id: subscription.id,
    workspaceId: subscription.workspaceId,
    planCode: subscription.planVersion.plan.code,
    planVersion: subscription.planVersion.version,
    planName: subscription.planVersion.plan.nameRu,
    status: subscription.status,
    period: subscription.period,
    currency: CURRENCY,
    currentPeriodStart: subscription.currentPeriodStart.toISOString(),
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    ...(subscription.trialEnd
      ? { trialEnd: subscription.trialEnd.toISOString() }
      : {}),
    ...(subscription.graceEnd
      ? { graceEnd: subscription.graceEnd.toISOString() }
      : {}),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    autopayEnabled:
      !subscription.cancelAtPeriodEnd &&
      subscription.defaultPaymentMethod?.status === "ACTIVE",
    version: subscription.version
  };
}

function orderSummary(
  order: Prisma.BillingOrderGetPayload<{
    include: typeof CHECKOUT_INCLUDE;
  }>
): BillingOrderSummary {
  const payment = order.payments[0];
  if (!payment) throw new Error("Billing order payment is missing");
  return {
    id: order.id,
    workspaceId: order.workspaceId,
    kind: order.kind,
    status: order.status,
    ...(order.planVersion
      ? {
          planCode: order.planVersion.plan.code,
          planVersion: order.planVersion.version
        }
      : {}),
    ...(order.period ? { period: order.period } : {}),
    amountMinor: safeMinor(order.amountMinor),
    currency: CURRENCY,
    description: order.serviceDescriptionSnapshot,
    payment: {
      id: payment.id,
      orderId: payment.orderId,
      provider: "YOOKASSA",
      status: payment.status,
      amountMinor: safeMinor(payment.amountMinor),
      currency: CURRENCY,
      ...(payment.confirmationUrl
        ? { confirmationUrl: payment.confirmationUrl }
        : {}),
      ...(payment.paymentMethodType
        ? { paymentMethodType: payment.paymentMethodType }
        : {}),
      ...(payment.succeededAt
        ? { succeededAt: payment.succeededAt.toISOString() }
        : {}),
      ...(payment.canceledAt
        ? { canceledAt: payment.canceledAt.toISOString() }
        : {}),
      refundedAmountMinor: safeMinor(payment.refundedAmountMinor),
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString()
    },
    createdAt: order.createdAt.toISOString(),
    ...(order.completedAt
      ? { completedAt: order.completedAt.toISOString() }
      : {})
  };
}

function paymentMethodSummary(method: {
  readonly id: string;
  readonly type: string;
  readonly title: string | null;
  readonly status: "ACTIVE" | "DISABLED";
  readonly consentedAt: Date;
  readonly disabledAt: Date | null;
  readonly version: number;
}): BillingPaymentMethodSummary {
  return {
    id: method.id,
    provider: "YOOKASSA",
    type: method.type,
    ...(method.title ? { title: method.title } : {}),
    status: method.status,
    consentedAt: method.consentedAt.toISOString(),
    ...(method.disabledAt
      ? { disabledAt: method.disabledAt.toISOString() }
      : {}),
    version: method.version
  };
}

function refundSummary(refund: {
  readonly id: string;
  readonly paymentId: string;
  readonly status: BillingRefundStatus;
  readonly amountMinor: bigint;
  readonly reason: string;
  readonly succeededAt: Date | null;
  readonly createdAt: Date;
}): BillingRefundSummary {
  return {
    id: refund.id,
    paymentId: refund.paymentId,
    status: refund.status,
    amountMinor: safeMinor(refund.amountMinor),
    currency: CURRENCY,
    reason: refund.reason,
    ...(refund.succeededAt
      ? { succeededAt: refund.succeededAt.toISOString() }
      : {}),
    createdAt: refund.createdAt.toISOString()
  };
}

function receiptSummary(receipt: {
  readonly id: string;
  readonly paymentId: string;
  readonly grossAmountMinor: bigint;
  readonly paidAt: Date;
  readonly serviceDescriptionSnapshot: string;
  readonly registrationMode: "MANUAL_MY_TAX";
  readonly status: NpdReceiptObligationSummary["status"];
  readonly officialReceiptId: string | null;
  readonly officialReceiptUrl: string | null;
  readonly registeredAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly version: number;
}): NpdReceiptObligationSummary {
  return {
    id: receipt.id,
    paymentId: receipt.paymentId,
    grossAmountMinor: safeMinor(receipt.grossAmountMinor),
    currency: CURRENCY,
    paidAt: receipt.paidAt.toISOString(),
    serviceDescription: receipt.serviceDescriptionSnapshot,
    registrationMode: receipt.registrationMode,
    status: receipt.status,
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
    version: receipt.version
  };
}

function providerPaymentStatus(
  status: YookassaPayment["status"]
): BillingPaymentStatus {
  if (status === "succeeded") return "SUCCEEDED";
  if (status === "canceled") return "CANCELED";
  return "PENDING";
}

function providerRefundStatus(
  status: YookassaRefund["status"]
): BillingRefundStatus {
  if (status === "succeeded") return "SUCCEEDED";
  if (status === "canceled") return "CANCELED";
  return "PENDING";
}

function terminalPaymentStatus(status: BillingPaymentStatus): boolean {
  return [
    "SUCCEEDED",
    "CANCELED",
    "PARTIALLY_REFUNDED",
    "REFUNDED",
    "FAILED_FINAL"
  ].includes(status);
}

function terminalRefundStatus(status: BillingRefundStatus): boolean {
  return ["SUCCEEDED", "CANCELED", "FAILED_FINAL"].includes(status);
}

function trialAlreadyUsed(): DomainError {
  return new DomainError({
    statusCode: 409,
    code: "RESOURCE_STATE_CONFLICT",
    message: "The workspace owner has already used a trial"
  });
}

function safeMinor(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error("Billing amount exceeds JSON safe integer range");
  }
  return number;
}

function hashRequest(
  domain: string,
  value: unknown
): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    Buffer.from(canonicalJsonSha256(domain, value), "hex")
  );
}

function assertRequestHash(
  current: Uint8Array,
  expected: Uint8Array
): void {
  if (!Buffer.from(current).equals(Buffer.from(expected))) {
    throw new DomainError({
      statusCode: 409,
      code: "IDEMPOTENCY_CONFLICT",
      message: "Idempotency key was already used with another request"
    });
  }
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function addPeriod(
  value: Date,
  period: "MONTHLY" | "ANNUAL"
): Date {
  const result = new Date(value);
  if (period === "MONTHLY") {
    result.setUTCMonth(result.getUTCMonth() + 1);
  } else {
    result.setUTCFullYear(result.getUTCFullYear() + 1);
  }
  return result;
}

function planOrder(code: string): number {
  const order = [
    "TRIAL",
    "SOLO",
    "TEAM",
    "AGENCY",
    "BUSINESS",
    "ENTERPRISE"
  ];
  const index = order.indexOf(code);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function requiredReturnUrl(config: AppConfig): string {
  const returnUrl = config.billing.yookassa.returnUrl;
  if (!returnUrl) {
    throw new Error("YooKassa return URL is missing");
  }
  return returnUrl;
}

function mapProviderError(error: unknown): Error {
  if (error instanceof DomainError) return error;
  if (error instanceof YookassaProviderError) {
    return new DomainError({
      statusCode: error.retryable ? 503 : 502,
      code: "PROVIDER_UNAVAILABLE",
      message: error.retryable
        ? "Payment provider is temporarily unavailable"
        : "Payment provider rejected the operation",
      retryable: error.retryable,
      details: { provider: "YOOKASSA", providerCode: error.code }
    });
  }
  return error instanceof Error ? error : new Error("Billing operation failed");
}

function providerUnavailable(reason: string): DomainError {
  return new DomainError({
    statusCode: 503,
    code: "PROVIDER_UNAVAILABLE",
    message: "Payment webhook processing is temporarily unavailable",
    retryable: true,
    details: { reason }
  });
}

function publicFailureCode(error: unknown): string {
  if (error instanceof YookassaProviderError) return error.code.slice(0, 100);
  if (error instanceof DomainError) return error.code;
  return "INTERNAL_ERROR";
}

function isRetryableTransactionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "P2034" || error.code === "40001")
  );
}

function notFound(): DomainError {
  return new DomainError({
    statusCode: 404,
    code: "NOT_FOUND",
    message: "Billing resource not found"
  });
}

function versionConflict(currentVersion: number): DomainError {
  return new DomainError({
    statusCode: 409,
    code: "VERSION_CONFLICT",
    message: "Billing resource version changed",
    details: { currentVersion }
  });
}
