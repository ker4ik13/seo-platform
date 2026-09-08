import type { BillingSubscription, Prisma } from "../generated/prisma/client.js";

/** Calendar billing clamps month-end instead of turning Jan 31 into March. */
export function addBillingPeriod(value: Date, period: "MONTHLY" | "ANNUAL"): Date {
  const result = new Date(value);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  if (period === "MONTHLY") result.setUTCMonth(result.getUTCMonth() + 1);
  else result.setUTCFullYear(result.getUTCFullYear() + 1);
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result;
}

export function unusedSubscriptionValue(valueMinor: bigint, anchor: Date, end: Date, at: Date): bigint {
  if (valueMinor < 0n || [anchor, end, at].some(date => !Number.isFinite(date.getTime()))) throw new RangeError("Invalid subscription valuation");
  if (end <= at || end <= anchor || valueMinor === 0n) return 0n;
  if (at <= anchor) return valueMinor;
  return valueMinor * BigInt(end.getTime() - at.getTime()) / BigInt(end.getTime() - anchor.getTime());
}

/** Read-only compatibility for a paid legacy period; no history is rewritten. */
export async function subscriptionValueAt(tx: Prisma.TransactionClient, subscription: BillingSubscription | null, at: Date): Promise<{ remainingMinor: bigint; refundableFrom: Date | null }> {
  if (!subscription) return { remainingMinor: 0n, refundableFrom: null };
  if (subscription.serviceValueMinor !== null && subscription.serviceValueMinor !== undefined && subscription.serviceValueAt) {
    return { remainingMinor: unusedSubscriptionValue(subscription.serviceValueMinor, subscription.serviceValueAt, subscription.currentPeriodEnd, at), refundableFrom: subscription.refundableFrom };
  }
  const payment = await tx.billingPayment.findFirst({ where: { workspaceId: subscription.workspaceId, isTest: false, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] }, succeededAt: subscription.currentPeriodStart, order: { kind: "SUBSCRIPTION" } }, orderBy: [{ succeededAt: "desc" }, { id: "desc" }] });
  if (!payment?.succeededAt) return { remainingMinor: 0n, refundableFrom: null };
  return { remainingMinor: unusedSubscriptionValue(payment.amountMinor - payment.refundedAmountMinor, payment.succeededAt, subscription.currentPeriodEnd, at), refundableFrom: payment.succeededAt };
}

export function subscriptionPaymentEnd(input: { at: Date; period: "MONTHLY" | "ANNUAL"; paidMinor: bigint; previousEnd?: Date; samePlan: boolean; carriedMinor: bigint }): Date {
  if (input.paidMinor <= 0n || input.carriedMinor < 0n) throw new RangeError("Invalid subscription payment value");
  if (input.samePlan && input.previousEnd && input.previousEnd > input.at) return addBillingPeriod(input.previousEnd, input.period);
  const end = addBillingPeriod(input.at, input.period);
  const bonusMs = input.carriedMinor * BigInt(end.getTime() - input.at.getTime()) / input.paidMinor;
  const result = new Date(end.getTime() + Number(bonusMs));
  if (!Number.isFinite(result.getTime()) || result.getUTCFullYear() > 9999) throw new RangeError("Subscription duration is outside the supported range");
  return result;
}
