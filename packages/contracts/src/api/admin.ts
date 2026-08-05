import type {
  BillingBuyerType,
  BillingPlanSummary,
  BillingSubscriptionSummary,
  NpdReceiptObligationSummary
} from "./billing.js";

export const platformRoleCodes = [
  "SUPER_ADMIN",
  "OPERATIONS",
  "SUPPORT",
  "FINANCE",
  "CONTENT",
  "SECURITY_AUDITOR",
  "ANALYST"
] as const;

export type PlatformRoleCode = (typeof platformRoleCodes)[number];

export interface PlatformAdminProfile {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly PlatformRoleCode[];
  readonly mfaVerified: true;
  readonly authenticatedAt: string;
}

export interface AdminNpdReceiptSummary
  extends NpdReceiptObligationSummary {
  readonly workspaceId: string;
  readonly yookassaPaymentId: string;
  readonly sequence: number;
  readonly ageSeconds: number;
  readonly deliveryAttempts: number;
  readonly cancelledAt?: string;
  readonly replacementReceiptId?: string;
}

export interface AdminNpdReceiptDetail
  extends AdminNpdReceiptSummary {
  readonly buyerType: BillingBuyerType;
  readonly buyerName?: string;
  readonly buyerInn?: string;
  readonly deliveryEmail: string;
  readonly refundedAmountMinor: number;
  readonly paymentStatus: string;
  readonly cancellationReason?: string;
  readonly cancellationOfficialReference?: string;
}

export interface AdminNpdReceiptListPage {
  readonly data: readonly AdminNpdReceiptSummary[];
  readonly nextCursor?: string;
}

export interface RegisterManualNpdReceiptInput {
  readonly officialReceiptId: string;
  readonly officialReceiptUrl: string;
  readonly registeredAt: string;
  readonly amountChecked: true;
  readonly buyerChecked: true;
  readonly reason: string;
}

export interface CancelManualNpdReceiptInput {
  readonly cancellationOfficialReference: string;
  readonly cancelledAt: string;
  readonly reason: string;
}

export interface ReplaceManualNpdReceiptInput
  extends RegisterManualNpdReceiptInput,
    CancelManualNpdReceiptInput {}

export interface PlatformStaffRoleAssignmentSummary {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly roleCode: PlatformRoleCode;
  readonly reason: string;
  readonly assignedBy?: string;
  readonly assignedAt: string;
  readonly revokedAt?: string;
  readonly version: number;
}

export interface AssignPlatformStaffRoleInput {
  readonly userId: string;
  readonly roleCode: PlatformRoleCode;
  readonly reason: string;
}

export interface RevokePlatformStaffRoleInput {
  readonly reason: string;
}

export type AdminWorkspaceStatus =
  | "ACTIVE"
  | "READ_ONLY"
  | "SUSPENDED"
  | "DELETING"
  | "DELETED";

export type AdminWorkspaceOwnerStatus =
  | "PENDING_VERIFICATION"
  | "ACTIVE"
  | "SUSPENDED"
  | "DELETED";

export interface AdminWorkspaceOwnerSummary {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: AdminWorkspaceOwnerStatus;
}

export interface AdminWorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: AdminWorkspaceStatus;
  readonly owner: AdminWorkspaceOwnerSummary;
  readonly memberCount: number;
  readonly projectCount: number;
  readonly subscription: BillingSubscriptionSummary | null;
  readonly createdAt: string;
  readonly version: number;
}

export interface AdminWorkspaceSearchResult {
  readonly data: readonly AdminWorkspaceSummary[];
  readonly truncated: boolean;
}

export type AdminBillingPlanSummary = BillingPlanSummary;

export interface GrantAdminWorkspaceSubscriptionInput {
  readonly planCode: string;
  readonly planVersion: number;
  readonly currentPeriodEnd: string;
  readonly confirmWorkspaceId: string;
  readonly confirmed: true;
  readonly reason: string;
}

export interface AdminWorkspaceSubscriptionGrantSummary {
  readonly workspaceId: string;
  readonly subscriptionId: string;
  readonly planCode: string;
  readonly planVersion: number;
  readonly planName: string;
  readonly status: "ACTIVE";
  readonly currentPeriodStart: string;
  readonly currentPeriodEnd: string;
  readonly version: number;
}
