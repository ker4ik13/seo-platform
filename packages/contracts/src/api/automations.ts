import type {
  AutomationCapacityEntitlement,
  JobCapacityEntitlement
} from "./billing.js";
import type { InternalRankEstimateProjectSnapshot } from "./rank-estimates.js";

export type AutomationSchedule =
  | {
      readonly cadence: "DAILY";
      readonly hour: number;
      readonly minute: number;
    }
  | {
      readonly cadence: "WEEKLY";
      readonly hour: number;
      readonly minute: number;
      /** ISO weekdays: Monday = 1, Sunday = 7. */
      readonly weekdays: readonly number[];
    };

export type RankTrackingAutomationSchedule =
  | AutomationSchedule
  | {
      readonly cadence: "ONCE";
      /** Exact UTC occurrence for a delayed one-time rank check. */
      readonly runAt: string;
    };

export interface CreateRankTrackingAutomationInput {
  readonly name: string;
  readonly trackingContextId: string;
  readonly timezone: string;
  readonly schedule: RankTrackingAutomationSchedule;
  /**
   * Maximum platform charge for one run in 1/1,000,000 currency units.
   * "0" keeps the schedule BYOK-only.
   */
  readonly maxPlatformChargeMicro: string;
  readonly failureThreshold: number;
  readonly enabled: boolean;
}

export type UpdateRankTrackingAutomationInput =
  CreateRankTrackingAutomationInput;

export interface AutomationExecutionAccessSnapshot {
  readonly workspaceStatus: "ACTIVE" | "READ_ONLY" | "SUSPENDED";
  readonly membershipId: string;
  readonly membershipVersion: number;
  readonly canRunRanking: boolean;
  readonly entitlementStatus: "ALLOWED" | "DENIED" | "NOT_AVAILABLE";
}

export interface InternalCreateRankTrackingAutomationInput
  extends CreateRankTrackingAutomationInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly project: InternalRankEstimateProjectSnapshot;
  readonly access: AutomationExecutionAccessSnapshot;
  readonly billingCurrency: string;
  readonly entitlement: AutomationCapacityEntitlement;
  readonly jobCapacity: JobCapacityEntitlement;
}

export interface InternalUpdateRankTrackingAutomationInput
  extends UpdateRankTrackingAutomationInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly automationId: string;
  readonly expectedVersion: number;
  readonly project: InternalRankEstimateProjectSnapshot;
  readonly access: AutomationExecutionAccessSnapshot;
  readonly billingCurrency: string;
  readonly entitlement: AutomationCapacityEntitlement;
  readonly jobCapacity: JobCapacityEntitlement;
}

export interface InternalAutomationStatusInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly automationId: string;
  readonly expectedVersion: number;
  readonly project: InternalRankEstimateProjectSnapshot;
  readonly access: AutomationExecutionAccessSnapshot;
  readonly billingCurrency: string;
  readonly entitlement: AutomationCapacityEntitlement;
  readonly jobCapacity: JobCapacityEntitlement;
}

export interface InternalDeleteRankTrackingAutomationInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly automationId: string;
  readonly expectedVersion: number;
}

export interface InternalRunRankTrackingAutomationInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly automationId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly project: InternalRankEstimateProjectSnapshot;
  readonly access: AutomationExecutionAccessSnapshot;
  readonly billingCurrency: string;
  readonly jobCapacity: JobCapacityEntitlement;
}

export interface RankTrackingAutomationSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly name: string;
  readonly trackingContextId: string;
  readonly timezone: string;
  readonly schedule: RankTrackingAutomationSchedule;
  readonly maxPlatformChargeMicro: string;
  readonly failureThreshold: number;
  readonly enabled: boolean;
  readonly pausedReason?:
    | "MANUAL"
    | "FAILURE_THRESHOLD"
    | "ONE_TIME_COMPLETED";
  readonly nextRunAt?: string;
  readonly lastRunAt?: string;
  readonly consecutiveErrors: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RankTrackingAutomationCollection {
  readonly automations: readonly RankTrackingAutomationSummary[];
  /** Plan limit for enabled schedules in the workspace, not a keyword limit. */
  readonly limit: number;
  readonly enabledCount: number;
  readonly truncated: boolean;
}

export interface RankTrackingAutomationAccess {
  readonly canManage: boolean;
  readonly canEnable: boolean;
  readonly mutationRestriction:
    | "NONE"
    | "MISSING_PERMISSION"
    | "WORKSPACE_READ_ONLY"
    | "PROJECT_ARCHIVED";
}

export interface RankTrackingAutomationSettings
  extends RankTrackingAutomationCollection {
  readonly access: RankTrackingAutomationAccess;
}

export type AutomationRunStatus =
  | "RUNNING"
  | "DISPATCHED"
  | "SKIPPED"
  | "COMPLETED"
  | "FAILED";

export interface AutomationRunSummary {
  readonly id: string;
  readonly automationId: string;
  readonly automationVersion: number;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly status: AutomationRunStatus;
  readonly trigger: "SCHEDULE" | "MANUAL";
  readonly scheduledFor: string;
  readonly estimateId?: string;
  readonly jobId?: string;
  readonly errorCode?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly createdAt: string;
}

export interface AutomationRunCollection {
  readonly runs: readonly AutomationRunSummary[];
  readonly truncated: boolean;
}

/** Trusted Jobs -> Platform command for one already-claimed automation run. */
export interface InternalDispatchRankAutomationRunInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly automationId: string;
  readonly automationVersion: number;
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly scheduledFor: string;
  readonly trackingContextId: string;
  readonly maxPlatformChargeMicro: string;
}

/** Minimal secret-free receipt returned after Platform creates the paid/BYOK Job. */
export interface InternalDispatchRankAutomationRunReceipt {
  readonly estimateId: string;
  readonly jobId: string;
}
