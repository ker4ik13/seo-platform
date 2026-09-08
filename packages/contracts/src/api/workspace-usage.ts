import type { BillingBalanceSummary, BillingPlanFeatures } from "./billing.js";

export interface WorkspaceUsageMetric {
  readonly used: number | null;
  /** null means no commercial limit; zero is a real zero quota. */
  readonly limit: number | null;
  readonly available: boolean;
}

export interface WorkspaceUsageSummary {
  readonly workspaceId: string;
  readonly calculatedAt: string;
  readonly plan: { readonly code: string; readonly version: number; readonly name: string; readonly features: BillingPlanFeatures } | null;
  readonly balance: BillingBalanceSummary;
  readonly resources: {
    readonly projects: WorkspaceUsageMetric;
    readonly keywords: WorkspaceUsageMetric;
    readonly seats: WorkspaceUsageMetric;
    readonly concurrentJobs: WorkspaceUsageMetric;
    readonly automations: WorkspaceUsageMetric;
    readonly storageBytes: WorkspaceUsageMetric;
  };
  readonly degraded: boolean;
}

export interface InternalWorkspaceExecutionUsage {
  readonly workspaceId: string;
  readonly concurrentJobs: number;
  readonly automations: number;
  readonly storageBytes: string;
}
