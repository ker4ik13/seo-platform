import { createHash, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { canonicalizeJson } from "@seo-platform/contracts/canonical-json";
import type {
  BillingUsageReservation,
  Prisma
} from "../generated/prisma/client.js";
import { uuidV7 } from "../common/uuid-v7.js";
import { BillingLedgerService } from "./billing-ledger.service.js";

const RESERVATION_TTL_MILLISECONDS = 10 * 60 * 1_000;
const RESERVATION_HOLD_MILLISECONDS = 60 * 1_000;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const BUSINESS_REFERENCE_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9:._-]{0,179}$/u;

export interface BillingUsageReservationInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly jobItemId: string;
  readonly executionAttempt: number;
  readonly provider: "ARSENKIN" | "XMLSTOCK";
  readonly operation: "POSITIONS";
  readonly quantity: number;
  readonly unitPriceMinor: bigint;
  readonly providerDailySpendLimitMinor: bigint;
  readonly providerMonthlySpendLimitMinor: bigint;
  readonly businessReference: string;
}

export interface BillingUsageReservationResult {
  readonly id: string;
  readonly status: "RESERVED" | "CAPTURED" | "RELEASED";
  readonly amountMinor: bigint;
  readonly includedAmountMinor: bigint;
  readonly prepaidAmountMinor: bigint;
}

export class BillingUsageInsufficientBalanceError extends Error {
  public constructor() {
    super("Workspace token balance is insufficient");
    this.name = "BillingUsageInsufficientBalanceError";
  }
}

export class BillingUsageIdempotencyConflictError extends Error {
  public constructor() {
    super("Billing usage idempotency conflict");
    this.name = "BillingUsageIdempotencyConflictError";
  }
}

export class BillingUsageReservationExpiredError extends Error {
  public constructor() {
    super("Billing usage reservation has expired");
    this.name = "BillingUsageReservationExpiredError";
  }
}

export class BillingUsageProviderBudgetExceededError extends Error {
  public constructor(public readonly window: "DAILY" | "MONTHLY") {
    super("Platform provider spending budget is exhausted");
    this.name = "BillingUsageProviderBudgetExceededError";
  }
}

@Injectable()
export class BillingUsageService {
  public constructor(private readonly ledger: BillingLedgerService) {}

  public async releaseExpired(
    transaction: Prisma.TransactionClient,
    batchSize: number
  ): Promise<number> {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
      throw new Error("Invalid billing usage release batch size");
    }
    const candidates = await transaction.$queryRaw<
      readonly { readonly id: string }[]
    >`
      SELECT "id"::text AS "id"
      FROM "billing_usage_reservations"
      WHERE "status" = 'RESERVED'
        AND "expires_at" <= clock_timestamp()
      ORDER BY "expires_at", "id"
      FOR UPDATE SKIP LOCKED
      LIMIT ${batchSize}
    `;
    for (const candidate of candidates) {
      await this.release(transaction, candidate.id);
    }
    return candidates.length;
  }

  public async reserve(
    transaction: Prisma.TransactionClient,
    input: BillingUsageReservationInput
  ): Promise<BillingUsageReservationResult> {
    validateInput(input);
    const requestHash = usageRequestHash(input);
    const replay =
      await transaction.billingUsageReservation.findUnique({
        where: { businessReference: input.businessReference }
      });
    if (replay) return replayResult(replay, requestHash);

    const amountMinor = input.unitPriceMinor * BigInt(input.quantity);
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          ${`billing-usage-provider-budget:${input.provider}`},
          0
        )
      )
    `;

    await transaction.$queryRaw`
      SELECT "id"
      FROM "workspaces"
      WHERE "id" = ${input.workspaceId}::uuid
      FOR UPDATE
    `;

    const lockedReplay =
      await transaction.billingUsageReservation.findUnique({
        where: { businessReference: input.businessReference }
      });
    if (lockedReplay) return replayResult(lockedReplay, requestHash);

    const [clock] = await transaction.$queryRaw<
      readonly { readonly now: Date }[]
    >`SELECT clock_timestamp() AS "now"`;
    if (!clock?.now || Number.isNaN(clock.now.getTime())) {
      throw new Error("Unable to allocate billing usage reservation");
    }
    await assertProviderBudget(
      transaction,
      input,
      amountMinor,
      clock.now
    );

    const balance = await this.ledger.balance(
      transaction,
      input.workspaceId
    );
    const includedAmountMinor = minimum(
      positiveBalance(balance.includedCreditsMinor),
      amountMinor
    );
    const prepaidAmountMinor = amountMinor - includedAmountMinor;
    if (positiveBalance(balance.prepaidMinor) < prepaidAmountMinor) {
      throw new BillingUsageInsufficientBalanceError();
    }
    const reservationId = uuidV7();
    const reservationTransactionId = await this.ledger.post(
      transaction,
      {
        type: "RESERVATION",
        businessReference: ledgerReference(reservationId, "reserve"),
        description: "Резерв внутренних токенов для вызова провайдера",
        occurredAt: clock.now,
        createdBy: input.actorId,
        metadata: ledgerMetadata(reservationId, input),
        entries: [
          ...(includedAmountMinor > 0n
            ? [
                {
                  workspaceId: input.workspaceId,
                  accountType: "PROMOTIONAL_LIABILITY" as const,
                  direction: "DEBIT" as const,
                  amountMinor: includedAmountMinor
                }
              ]
            : []),
          ...(prepaidAmountMinor > 0n
            ? [
                {
                  workspaceId: input.workspaceId,
                  accountType: "CUSTOMER_PREPAID_LIABILITY" as const,
                  direction: "DEBIT" as const,
                  amountMinor: prepaidAmountMinor
                }
              ]
            : []),
          {
            workspaceId: input.workspaceId,
            accountType: "RESERVATION" as const,
            direction: "CREDIT" as const,
            amountMinor
          }
        ]
      }
    );
    const reservation =
      await transaction.billingUsageReservation.create({
        data: {
          id: reservationId,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          actorId: input.actorId,
          jobId: input.jobId,
          jobItemId: input.jobItemId,
          executionAttempt: input.executionAttempt,
          provider: input.provider,
          operation: input.operation,
          quantity: input.quantity,
          unitPriceMinor: input.unitPriceMinor,
          amountMinor,
          includedAmountMinor,
          prepaidAmountMinor,
          businessReference: input.businessReference,
          requestHash: Uint8Array.from(requestHash),
          reservationTransactionId,
          reservedAt: clock.now,
          expiresAt: new Date(
            clock.now.getTime() + RESERVATION_TTL_MILLISECONDS
          )
        }
      });
    return reservationResult(reservation);
  }

  public async capture(
    transaction: Prisma.TransactionClient,
    reservationId: string
  ): Promise<BillingUsageReservationResult> {
    const reservation = await lockReservation(transaction, reservationId);
    if (reservation.status === "CAPTURED") {
      return reservationResult(reservation);
    }
    if (reservation.status !== "RESERVED") {
      throw new Error("Released billing usage cannot be captured");
    }
    const [clock] = await transaction.$queryRaw<
      readonly { readonly now: Date }[]
    >`SELECT clock_timestamp() AS "now"`;
    if (!clock?.now || Number.isNaN(clock.now.getTime())) {
      throw new Error("Unable to capture billing usage reservation");
    }
    if (clock.now.getTime() >= reservation.expiresAt.getTime()) {
      throw new BillingUsageReservationExpiredError();
    }
    const captureTransactionId = await this.ledger.post(transaction, {
      type: "CAPTURE",
      businessReference: ledgerReference(reservation.id, "capture"),
      description: "Списание внутренних токенов за вызов провайдера",
      occurredAt: clock.now,
      createdBy: reservation.actorId,
      metadata: storedLedgerMetadata(reservation),
      entries: [
        {
          workspaceId: reservation.workspaceId,
          accountType: "RESERVATION",
          direction: "DEBIT",
          amountMinor: reservation.amountMinor
        },
        {
          accountType: "PROVIDER_COST",
          direction: "CREDIT",
          amountMinor: reservation.amountMinor
        }
      ]
    });
    const captured =
      await transaction.billingUsageReservation.update({
        where: { id: reservation.id },
        data: {
          status: "CAPTURED",
          captureTransactionId,
          capturedAt: clock.now
        }
      });
    return reservationResult(captured);
  }

  public async hold(
    transaction: Prisma.TransactionClient,
    reservationId: string
  ): Promise<BillingUsageReservationResult> {
    const reservation = await lockReservation(transaction, reservationId);
    if (reservation.status === "CAPTURED") {
      return reservationResult(reservation);
    }
    if (reservation.status !== "RESERVED") {
      throw new BillingUsageReservationExpiredError();
    }
    const [clock] = await transaction.$queryRaw<
      readonly { readonly now: Date }[]
    >`SELECT clock_timestamp() AS "now"`;
    if (!clock?.now || Number.isNaN(clock.now.getTime())) {
      throw new Error("Unable to hold billing usage reservation");
    }
    if (clock.now.getTime() >= reservation.expiresAt.getTime()) {
      throw new BillingUsageReservationExpiredError();
    }
    const holdExpiresAt = new Date(
      clock.now.getTime() + RESERVATION_HOLD_MILLISECONDS
    );
    if (reservation.expiresAt.getTime() >= holdExpiresAt.getTime()) {
      return reservationResult(reservation);
    }
    const held = await transaction.billingUsageReservation.update({
      where: { id: reservation.id },
      data: { expiresAt: holdExpiresAt }
    });
    return reservationResult(held);
  }

  public async release(
    transaction: Prisma.TransactionClient,
    reservationId: string
  ): Promise<BillingUsageReservationResult> {
    const reservation = await lockReservation(transaction, reservationId);
    if (reservation.status === "RELEASED") {
      return reservationResult(reservation);
    }
    if (reservation.status !== "RESERVED") {
      throw new Error("Captured billing usage cannot be released");
    }
    const [clock] = await transaction.$queryRaw<
      readonly { readonly now: Date }[]
    >`SELECT clock_timestamp() AS "now"`;
    if (!clock?.now || Number.isNaN(clock.now.getTime())) {
      throw new Error("Unable to release billing usage reservation");
    }
    const releaseTransactionId = await this.ledger.post(transaction, {
      type: "RELEASE",
      businessReference: ledgerReference(reservation.id, "release"),
      description: "Возврат неиспользованного резерва внутренних токенов",
      occurredAt: clock.now,
      createdBy: reservation.actorId,
      metadata: storedLedgerMetadata(reservation),
      entries: [
        {
          workspaceId: reservation.workspaceId,
          accountType: "RESERVATION",
          direction: "DEBIT",
          amountMinor: reservation.amountMinor
        },
        ...(reservation.includedAmountMinor > 0n
          ? [
              {
                workspaceId: reservation.workspaceId,
                accountType: "PROMOTIONAL_LIABILITY" as const,
                direction: "CREDIT" as const,
                amountMinor: reservation.includedAmountMinor
              }
            ]
          : []),
        ...(reservation.prepaidAmountMinor > 0n
          ? [
              {
                workspaceId: reservation.workspaceId,
                accountType: "CUSTOMER_PREPAID_LIABILITY" as const,
                direction: "CREDIT" as const,
                amountMinor: reservation.prepaidAmountMinor
              }
            ]
          : [])
      ]
    });
    const released =
      await transaction.billingUsageReservation.update({
        where: { id: reservation.id },
        data: {
          status: "RELEASED",
          releaseTransactionId,
          releasedAt: clock.now
        }
      });
    return reservationResult(released);
  }
}

function validateInput(input: BillingUsageReservationInput): void {
  if (
    !Number.isSafeInteger(input.quantity) ||
    input.quantity <= 0 ||
    !Number.isSafeInteger(input.executionAttempt) ||
    input.executionAttempt < 1 ||
    input.executionAttempt > 1_000 ||
    input.unitPriceMinor <= 0n ||
    input.unitPriceMinor > POSTGRES_BIGINT_MAX ||
    input.providerDailySpendLimitMinor <= 0n ||
    input.providerDailySpendLimitMinor > POSTGRES_BIGINT_MAX ||
    input.providerMonthlySpendLimitMinor <
      input.providerDailySpendLimitMinor ||
    input.providerMonthlySpendLimitMinor > POSTGRES_BIGINT_MAX ||
    input.unitPriceMinor * BigInt(input.quantity) > POSTGRES_BIGINT_MAX ||
    !BUSINESS_REFERENCE_PATTERN.test(input.businessReference)
  ) {
    throw new Error("Invalid billing usage reservation input");
  }
}

async function assertProviderBudget(
  transaction: Prisma.TransactionClient,
  input: BillingUsageReservationInput,
  requestedAmountMinor: bigint,
  now: Date
): Promise<void> {
  const dayStartedAt = utcDay(now);
  const monthStartedAt = utcMonth(now);
  const [exposure] = await transaction.$queryRaw<
    readonly {
      readonly dailyCapturedMinor: string;
      readonly monthlyCapturedMinor: string;
      readonly reservedMinor: string;
    }[]
  >`
    SELECT
      COALESCE(
        SUM("amount_minor") FILTER (
          WHERE "status" = 'CAPTURED'
            AND "captured_at" >= ${dayStartedAt}
        ),
        0
      )::text AS "dailyCapturedMinor",
      COALESCE(
        SUM("amount_minor") FILTER (
          WHERE "status" = 'CAPTURED'
            AND "captured_at" >= ${monthStartedAt}
        ),
        0
      )::text AS "monthlyCapturedMinor",
      COALESCE(
        SUM("amount_minor") FILTER (
          WHERE "status" = 'RESERVED'
            AND "expires_at" > ${now}
        ),
        0
      )::text AS "reservedMinor"
    FROM "billing_usage_reservations"
    WHERE "provider" = ${input.provider}
      AND (
        ("status" = 'CAPTURED' AND "captured_at" >= ${monthStartedAt})
        OR ("status" = 'RESERVED' AND "expires_at" > ${now})
      )
  `;
  if (!exposure) {
    throw new Error("Unable to read platform provider spending budget");
  }
  const reservedMinor = budgetAmount(exposure.reservedMinor);
  const dailyExposureMinor =
    budgetAmount(exposure.dailyCapturedMinor) + reservedMinor;
  if (
    dailyExposureMinor + requestedAmountMinor >
    input.providerDailySpendLimitMinor
  ) {
    throw new BillingUsageProviderBudgetExceededError("DAILY");
  }
  const monthlyExposureMinor =
    budgetAmount(exposure.monthlyCapturedMinor) + reservedMinor;
  if (
    monthlyExposureMinor + requestedAmountMinor >
    input.providerMonthlySpendLimitMinor
  ) {
    throw new BillingUsageProviderBudgetExceededError("MONTHLY");
  }
}

function budgetAmount(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,30})$/u.test(value)) {
    throw new Error("Invalid platform provider spending projection");
  }
  return BigInt(value);
}

function utcDay(value: Date): Date {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate()
    )
  );
}

function utcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function usageRequestHash(input: BillingUsageReservationInput): Buffer {
  return createHash("sha256")
    .update("billing-usage-reservation@1\u0000", "utf8")
    .update(
      canonicalizeJson({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        actorId: input.actorId,
        jobId: input.jobId,
        jobItemId: input.jobItemId,
        provider: input.provider,
        operation: input.operation,
        quantity: input.quantity,
        unitPriceMinor: input.unitPriceMinor.toString(),
        businessReference: input.businessReference
      }),
      "utf8"
    )
    .digest();
}

function replayResult(
  reservation: BillingUsageReservation,
  requestHash: Buffer
): BillingUsageReservationResult {
  const stored = Buffer.from(reservation.requestHash);
  if (
    stored.length !== requestHash.length ||
    !timingSafeEqual(stored, requestHash)
  ) {
    throw new BillingUsageIdempotencyConflictError();
  }
  return reservationResult(reservation);
}

function reservationResult(
  reservation: BillingUsageReservation
): BillingUsageReservationResult {
  return {
    id: reservation.id,
    status: reservation.status,
    amountMinor: reservation.amountMinor,
    includedAmountMinor: reservation.includedAmountMinor,
    prepaidAmountMinor: reservation.prepaidAmountMinor
  };
}

async function lockReservation(
  transaction: Prisma.TransactionClient,
  reservationId: string
): Promise<BillingUsageReservation> {
  await transaction.$queryRaw`
    SELECT "id"
    FROM "billing_usage_reservations"
    WHERE "id" = ${reservationId}::uuid
    FOR UPDATE
  `;
  const reservation =
    await transaction.billingUsageReservation.findUnique({
      where: { id: reservationId }
    });
  if (!reservation) throw new Error("Billing usage reservation not found");
  return reservation;
}

function ledgerReference(
  reservationId: string,
  action: "reserve" | "capture" | "release"
): string {
  return `billing-usage:${reservationId}:${action}`;
}

function ledgerMetadata(
  reservationId: string,
  input: BillingUsageReservationInput
): Prisma.InputJsonValue {
  return {
    reservationId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    jobId: input.jobId,
    jobItemId: input.jobItemId,
    executionAttempt: input.executionAttempt,
    provider: input.provider,
    operation: input.operation,
    quantity: input.quantity,
    unitPriceMinor: input.unitPriceMinor.toString()
  };
}

function storedLedgerMetadata(
  reservation: BillingUsageReservation
): Prisma.InputJsonValue {
  return {
    reservationId: reservation.id,
    workspaceId: reservation.workspaceId,
    projectId: reservation.projectId,
    jobId: reservation.jobId,
    jobItemId: reservation.jobItemId,
    executionAttempt: reservation.executionAttempt,
    provider: reservation.provider,
    operation: reservation.operation,
    quantity: reservation.quantity,
    unitPriceMinor: reservation.unitPriceMinor.toString()
  };
}

function positiveBalance(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function minimum(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
