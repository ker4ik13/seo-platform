import type { AutomationCapacityEntitlement } from "./billing.js";
import type {
  TechnicalCrawlConfig,
  TechnicalCrawlSummary
} from "./crawls.js";
import type { AutomationSchedule } from "./automations.js";

export interface CrawlAllowedWindow {
  /** Inclusive local minute after midnight. */
  readonly startMinute: number;
  /** Exclusive local minute after midnight; 1440 means midnight next day. */
  readonly endMinute: number;
}

export interface CreateCrawlAutomationInput {
  readonly name: string;
  readonly timezone: string;
  readonly schedule: AutomationSchedule;
  readonly allowedWindow: CrawlAllowedWindow;
  readonly config: TechnicalCrawlConfig;
  readonly failureThreshold: number;
  readonly enabled: boolean;
}

export type UpdateCrawlAutomationInput = CreateCrawlAutomationInput;

export interface InternalCreateCrawlAutomationInput
  extends CreateCrawlAutomationInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly entitlement: AutomationCapacityEntitlement;
}

export interface InternalUpdateCrawlAutomationInput
  extends UpdateCrawlAutomationInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly automationId: string;
  readonly expectedVersion: number;
  readonly entitlement: AutomationCapacityEntitlement;
}

export interface InternalCrawlAutomationStatusInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly automationId: string;
  readonly expectedVersion: number;
  readonly entitlement: AutomationCapacityEntitlement;
}

export interface InternalRunCrawlAutomationInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly automationId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export interface CrawlAutomationSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly name: string;
  readonly timezone: string;
  readonly schedule: AutomationSchedule;
  readonly allowedWindow: CrawlAllowedWindow;
  readonly config: TechnicalCrawlConfig;
  readonly failureThreshold: number;
  readonly enabled: boolean;
  readonly pausedReason?:
    | "MANUAL"
    | "FAILURE_THRESHOLD"
    | "AUTHORIZATION_REVOKED"
    | "READ_ONLY_BILLING";
  readonly nextRunAt?: string;
  readonly lastRunAt?: string;
  readonly consecutiveErrors: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CrawlAutomationCollection {
  readonly automations: readonly CrawlAutomationSummary[];
  readonly limit: number;
  readonly enabledCount: number;
  readonly truncated: boolean;
}

export interface CrawlAutomationAccess {
  readonly canManage: boolean;
  readonly canEnable: boolean;
  readonly mutationRestriction:
    | "NONE"
    | "MISSING_PERMISSION"
    | "WORKSPACE_READ_ONLY"
    | "PROJECT_ARCHIVED";
}

export interface CrawlAutomationSettings
  extends CrawlAutomationCollection {
  readonly access: CrawlAutomationAccess;
}

export interface CrawlAutomationRunSummary {
  readonly id: string;
  readonly automationId: string;
  readonly automationVersion: number;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly status:
    | "RUNNING"
    | "DISPATCHED"
    | "SKIPPED"
    | "COMPLETED"
    | "FAILED";
  readonly trigger: "SCHEDULE" | "MANUAL";
  readonly scheduledFor: string;
  readonly crawlId?: string;
  readonly jobId?: string;
  readonly errorCode?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly createdAt: string;
}

export interface CrawlAutomationRunCollection {
  readonly runs: readonly CrawlAutomationRunSummary[];
  readonly truncated: boolean;
}

export interface InternalDispatchCrawlAutomationRunInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly automationId: string;
  readonly automationVersion: number;
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly scheduledFor: string;
  readonly config: TechnicalCrawlConfig;
}

export interface InternalDispatchCrawlAutomationRunReceipt {
  readonly crawl: TechnicalCrawlSummary;
}
