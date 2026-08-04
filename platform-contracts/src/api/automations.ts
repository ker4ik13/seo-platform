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

export interface CreateRankTrackingAutomationInput {
  readonly name: string;
  readonly trackingContextId: string;
  readonly timezone: string;
  readonly schedule: AutomationSchedule;
  readonly maxItems: number;
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
  readonly schedule: AutomationSchedule;
  readonly maxItems: number;
  readonly failureThreshold: number;
  readonly enabled: boolean;
  readonly pausedReason?: "MANUAL" | "FAILURE_THRESHOLD";
  readonly nextRunAt?: string;
  readonly lastRunAt?: string;
  readonly consecutiveErrors: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RankTrackingAutomationCollection {
  readonly automations: readonly RankTrackingAutomationSummary[];
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
