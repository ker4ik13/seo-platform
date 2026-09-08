import type { BillingSubscriptionSummary } from "@seo-platform/contracts";

// The permanent free tier keeps the legacy TRIAL code and a database sentinel.
// Do not display that sentinel as a real renewal date (local time may show 10000).
export function isPermanentFreeSubscription(
  subscription: Pick<BillingSubscriptionSummary, "planCode" | "currentPeriodEnd"> | null | undefined
): boolean {
  return subscription?.planCode === "TRIAL" &&
    new Date(subscription.currentPeriodEnd).getUTCFullYear() === 9999;
}
