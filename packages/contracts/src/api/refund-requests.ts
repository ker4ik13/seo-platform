import type { BillingPaymentProvider } from "./billing.js";
export const billingRefundRequestStatuses = ["REQUESTED", "APPROVED", "PROCESSING", "MANUAL_REQUIRED", "SUCCEEDED", "REJECTED", "FAILED"] as const;
export type BillingRefundRequestStatus = typeof billingRefundRequestStatuses[number];
export interface BillingRefundEligibility {
  readonly paymentId: string;
  readonly workspaceId: string;
  readonly maximumAmountMinor: number;
  readonly currency: "RUB";
  readonly requiresManualTransfer: boolean;
  readonly reason: "AVAILABLE" | "TEST_PAYMENT" | "PAYMENT_NOT_SETTLED" | "NO_UNUSED_VALUE" | "OPEN_REQUEST" | "METHOD_NOT_SUPPORTED";
}
export interface BillingRefundRequestSummary {
  readonly id: string;
  readonly paymentId: string;
  readonly workspaceId: string;
  readonly provider: BillingPaymentProvider;
  readonly status: BillingRefundRequestStatus;
  readonly requestedAmountMinor: number;
  readonly approvedAmountMinor?: number;
  readonly currency: "RUB";
  readonly reason: string;
  readonly decisionReason?: string;
  readonly createdAt: string;
  readonly decidedAt?: string;
  readonly version: number;
}
export interface AdminRefundRequest extends BillingRefundRequestSummary {
  readonly workspaceName: string;
  readonly description: string;
  readonly maximumAmountMinor: number;
}
