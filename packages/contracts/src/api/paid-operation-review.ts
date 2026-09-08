import type { PaidOperationKind } from "./paid-operations.js";

export type PaidUsageResolution = "CHARGE" | "RELEASE";
export interface PaidUsageReviewTicket {
  readonly id: string;
  readonly part: string;
  readonly unitsMilli: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly resolution: PaidUsageResolution | null;
  readonly resolvedAt: string | null;
  readonly resolutionReason: string | null;
  readonly providerReference: string | null;
  readonly eligibleAt: string;
}
export interface InternalPaidUsageReview {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly quoteId: string;
  readonly commandHash: string;
  readonly terminal: boolean;
  readonly tickets: readonly PaidUsageReviewTicket[];
}
export interface ResolvePaidUsageInput {
  readonly resolution: PaidUsageResolution;
  readonly reason: string;
  readonly providerReference?: string;
}
export interface AdminPaidUsageReview {
  readonly quoteId: string;
  readonly jobId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly projectId: string;
  readonly kind: PaidOperationKind | "RANK";
  readonly provider: "XMLSTOCK" | "ARSENKIN";
  readonly maximumChargeMinor: number;
  readonly capturedMinor: number;
  readonly reservedMinor: number;
  readonly createdAt: string;
  readonly terminal: boolean;
  readonly tickets: readonly PaidUsageReviewTicket[];
}
