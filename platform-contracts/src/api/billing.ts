export const billingPeriods = ["MONTHLY", "ANNUAL"] as const;
export type BillingPeriod = (typeof billingPeriods)[number];

export const billingSubscriptionStatuses = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE",
  "PAUSED",
  "CANCELLING",
  "CANCELLED",
  "SUSPENDED"
] as const;
export type BillingSubscriptionStatus =
  (typeof billingSubscriptionStatuses)[number];

export const billingOrderKinds = ["SUBSCRIPTION", "TOP_UP"] as const;
export type BillingOrderKind = (typeof billingOrderKinds)[number];

export const billingOrderStatuses = [
  "PENDING",
  "PROVIDER_PENDING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "PARTIALLY_REFUNDED",
  "REFUNDED"
] as const;
export type BillingOrderStatus = (typeof billingOrderStatuses)[number];

export const billingPaymentStatuses = [
  "CREATING",
  "PENDING",
  "SUCCEEDED",
  "CANCELED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL"
] as const;
export type BillingPaymentStatus =
  (typeof billingPaymentStatuses)[number];

export const billingBuyerTypes = [
  "INDIVIDUAL",
  "INDIVIDUAL_ENTREPRENEUR",
  "LEGAL_ENTITY"
] as const;
export type BillingBuyerType = (typeof billingBuyerTypes)[number];

export interface BillingPlanFeatures {
  readonly seats: number;
  readonly projects: number;
  readonly storedKeywords: number;
  readonly keywordsPerProject: number;
  readonly trackedContextPairs: number;
  readonly storageBytes: number;
  readonly rawSerpRetentionDays: number;
  readonly scheduledAutomations: number;
  readonly guestReports: number;
  readonly byok: boolean;
  readonly publicApi: "SANDBOX" | "BASIC";
  readonly clientRole: boolean;
  readonly whiteLabel: boolean;
  readonly queuePriority:
    | "TRIAL"
    | "NORMAL"
    | "NORMAL_PLUS"
    | "HIGH"
    | "HIGHEST_FAIR_USE";
}

/**
 * Immutable plan limits attached by Platform API to trusted internal
 * commands. Data-owning services use this snapshot to enforce capacity
 * atomically with the write; browser clients never supply it.
 */
export interface SemanticCapacityEntitlement {
  readonly planCode: string;
  readonly planVersion: number;
  readonly storedKeywords: number;
  readonly keywordsPerProject: number;
  readonly trackedContextPairs: number;
}

export interface StorageCapacityEntitlement {
  readonly planCode: string;
  readonly planVersion: number;
  readonly storageBytes: number;
}

export interface AutomationCapacityEntitlement {
  readonly planCode: string;
  readonly planVersion: number;
  readonly scheduledAutomations: number;
}

export interface BillingPlanPrice {
  readonly period: BillingPeriod;
  readonly currency: "RUB";
  readonly amountMinor: number;
}

export interface BillingPlanSummary {
  readonly code: string;
  readonly version: number;
  readonly name: string;
  readonly description: string;
  readonly trialDays: number;
  readonly includedDataCreditsMinor: number;
  readonly serviceDescription: string;
  readonly features: BillingPlanFeatures;
  readonly prices: readonly BillingPlanPrice[];
  readonly effectiveFrom: string;
}

export interface BillingSubscriptionSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly planCode: string;
  readonly planVersion: number;
  readonly planName: string;
  readonly status: BillingSubscriptionStatus;
  readonly period: BillingPeriod;
  readonly currency: "RUB";
  readonly currentPeriodStart: string;
  readonly currentPeriodEnd: string;
  readonly trialEnd?: string;
  readonly graceEnd?: string;
  readonly cancelAtPeriodEnd: boolean;
  readonly autopayEnabled: boolean;
  readonly version: number;
}

export interface BillingBalanceSummary {
  readonly workspaceId: string;
  readonly currency: "RUB";
  readonly prepaidMinor: number;
  readonly includedCreditsMinor: number;
  readonly availableMinor: number;
  readonly updatedAt?: string;
}

export interface BillingPaymentSummary {
  readonly id: string;
  readonly orderId: string;
  readonly provider: "YOOKASSA";
  readonly status: BillingPaymentStatus;
  readonly amountMinor: number;
  readonly currency: "RUB";
  readonly confirmationUrl?: string;
  readonly paymentMethodType?: string;
  readonly succeededAt?: string;
  readonly canceledAt?: string;
  readonly refundedAmountMinor: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BillingOrderSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: BillingOrderKind;
  readonly status: BillingOrderStatus;
  readonly planCode?: string;
  readonly planVersion?: number;
  readonly period?: BillingPeriod;
  readonly amountMinor: number;
  readonly currency: "RUB";
  readonly description: string;
  readonly payment: BillingPaymentSummary;
  readonly createdAt: string;
  readonly completedAt?: string;
}

export interface BillingLedgerEntrySummary {
  readonly accountType: string;
  readonly direction: "DEBIT" | "CREDIT";
  readonly amountMinor: number;
  readonly currency: "RUB";
}

export interface BillingLedgerTransactionSummary {
  readonly id: string;
  readonly type: string;
  readonly businessReference: string;
  readonly description: string;
  readonly occurredAt: string;
  readonly entries: readonly BillingLedgerEntrySummary[];
}

export interface BillingPaymentMethodSummary {
  readonly id: string;
  readonly provider: "YOOKASSA";
  readonly type: string;
  readonly title?: string;
  readonly status: "ACTIVE" | "DISABLED";
  readonly consentedAt: string;
  readonly disabledAt?: string;
  readonly version: number;
}

export interface NpdReceiptObligationSummary {
  readonly id: string;
  readonly paymentId: string;
  readonly grossAmountMinor: number;
  readonly currency: "RUB";
  readonly paidAt: string;
  readonly serviceDescription: string;
  readonly registrationMode: "MANUAL_MY_TAX";
  readonly status:
    | "PENDING"
    | "AWAITING_MANUAL_REGISTRATION"
    | "REGISTERING"
    | "REGISTERED"
    | "DELIVERY_PENDING"
    | "DELIVERED"
    | "FAILED_RETRYABLE"
    | "FAILED_FINAL"
    | "CANCELLATION_PENDING"
    | "CANCELLED"
    | "REPLACEMENT_REQUIRED";
  readonly officialReceiptId?: string;
  readonly officialReceiptUrl?: string;
  readonly registeredAt?: string;
  readonly deliveredAt?: string;
  readonly version: number;
}

export interface CreateBillingCheckoutInput {
  readonly planCode: string;
  readonly period: BillingPeriod;
  readonly buyerType: BillingBuyerType;
  readonly buyerName?: string;
  readonly buyerInn?: string;
  readonly deliveryEmail: string;
  readonly savePaymentMethod: boolean;
  readonly termsAccepted: true;
  readonly termsVersion: string;
}

export interface CreateBillingTopUpInput {
  readonly amountMinor: number;
  readonly buyerType: BillingBuyerType;
  readonly buyerName?: string;
  readonly buyerInn?: string;
  readonly deliveryEmail: string;
  readonly savePaymentMethod: boolean;
  readonly termsAccepted: true;
  readonly termsVersion: string;
}

export interface CreateBillingRefundInput {
  readonly amountMinor: number;
  readonly reason: string;
}

export interface BillingRefundSummary {
  readonly id: string;
  readonly paymentId: string;
  readonly status:
    | "CREATING"
    | "PENDING"
    | "SUCCEEDED"
    | "CANCELED"
    | "FAILED_RETRYABLE"
    | "FAILED_FINAL";
  readonly amountMinor: number;
  readonly currency: "RUB";
  readonly reason: string;
  readonly succeededAt?: string;
  readonly createdAt: string;
}
