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
  readonly version?: number;
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

export type AdminProjectStatus =
  | "DRAFT"
  | "ACTIVE"
  | "ARCHIVED"
  | "DELETING"
  | "DELETED";

export interface AdminProjectIdentitySummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: AdminWorkspaceStatus;
}

export interface AdminProjectSemanticCounts {
  readonly projectId: string;
  readonly keywordCount: number;
  readonly folderCount: number;
}

export interface AdminProjectSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly slug: string;
  readonly domain: string;
  readonly status: AdminProjectStatus;
  readonly workspace: AdminProjectIdentitySummary;
  readonly owner: AdminWorkspaceOwnerSummary;
  readonly author: AdminWorkspaceOwnerSummary;
  readonly keywordCount: number | null;
  readonly folderCount: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminProjectSearchResult {
  readonly data: readonly AdminProjectSummary[];
  readonly truncated: boolean;
  readonly semanticCountsAvailable: boolean;
}

export const adminOperationStatuses = [
  "DRAFT",
  "ESTIMATING",
  "AWAITING_APPROVAL",
  "RESERVING_BALANCE",
  "PREPARING",
  "QUEUED",
  "WAITING_RATE_LIMIT",
  "RUNNING",
  "PAUSE_REQUESTED",
  "PAUSED",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "RETRY_SCHEDULED",
  "PARTIALLY_COMPLETED",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "ACTION_REQUIRED",
  "EXPIRED"
] as const;

export type AdminOperationStatus =
  (typeof adminOperationStatuses)[number];

export type AdminOperationStatusGroup =
  | "ALL"
  | "ACTIVE"
  | "COMPLETED"
  | "ATTENTION";

export interface AdminOperationProgress {
  readonly current: string;
  readonly total?: string;
  readonly unit?: string;
}

export interface AdminOperationResultMetrics {
  readonly processed?: number;
  readonly succeeded?: number;
  readonly failed?: number;
  readonly found?: number;
  readonly notFound?: number;
  readonly issues?: number;
}

export interface InternalAdminOperationSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId?: string;
  readonly actorId?: string;
  readonly type: string;
  readonly status: AdminOperationStatus;
  readonly stage?: string;
  readonly provider?: string;
  readonly searchEngine?: "YANDEX" | "GOOGLE";
  readonly searchSource?: "LIVE" | "SEARCH_API";
  readonly yandexLiveMode?: "TURBO";
  readonly frequencyMode?: "FREQUENCY" | "SEASONALITY";
  readonly connection?: {
    readonly label: string;
    readonly displayHint?: string;
  };
  readonly workers?: readonly {
    readonly name: string;
    readonly activeTasks: number;
    readonly nodeId?: string;
    readonly status?: "ONLINE" | "OFFLINE" | "DRAINING" | "DISABLED" | "MAIN";
    readonly assignedOperations?: number;
  }[];
  readonly progress: AdminOperationProgress;
  /** Current Arsenkin task progress; independent of persisted keyword progress. */
  readonly providerProgressPercent?: number;
  readonly result: AdminOperationResultMetrics;
  readonly errorCode?: string;
  readonly actualCostMicro?: string;
  readonly currency?: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly createdAt: string;
  readonly queuedAt?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly updatedAt: string;
}

export interface AdminOperationTypeCount {
  readonly type: string;
  readonly count: number;
}

export interface AdminOperationTotals {
  readonly total: number;
  readonly active: number;
  readonly completed: number;
  readonly attention: number;
}

export interface InternalAdminOperationSearchResult {
  readonly data: readonly InternalAdminOperationSummary[];
  readonly nextCursor?: string;
  readonly totals: AdminOperationTotals;
  readonly types: readonly AdminOperationTypeCount[];
}

export interface AdminOperationProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
}

export interface AdminOperationWorkspaceSummary {
  readonly id: string;
  readonly name: string;
}

export interface AdminOperationActorSummary {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}

export interface AdminOperationSummary
  extends InternalAdminOperationSummary {
  readonly workspace: AdminOperationWorkspaceSummary | null;
  readonly project: AdminOperationProjectSummary | null;
  readonly actor: AdminOperationActorSummary | null;
}

export interface AdminOperationSearchResult {
  readonly data: readonly AdminOperationSummary[];
  readonly nextCursor?: string;
  readonly totals: AdminOperationTotals;
  readonly types: readonly AdminOperationTypeCount[];
}
