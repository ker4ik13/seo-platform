import type { BillingProviderAvailability } from "./billing.js";
export interface InternalExecutionOverview {
  readonly active: number;
  readonly queued: number;
  readonly attention: number;
  readonly failed24h: number;
  readonly completed30d: number;
  readonly byType30d: readonly { readonly type: string; readonly count: number }[];
}
export interface InternalSeoOverview {
  readonly activeKeywords: number;
  readonly trashedKeywords: number;
  readonly activeFolders: number;
  readonly activatedWorkspaces: number;
}
export interface AdminOverview {
  readonly generatedAt: string;
  readonly users: { readonly total: number; readonly active7d: number; readonly registered7d: number; readonly unverified: number };
  readonly workspaces: { readonly total: number; readonly withProjects: number; readonly paying: number; readonly readOnly: number };
  readonly projects: number;
  readonly seo: InternalSeoOverview | null;
  readonly execution: InternalExecutionOverview | null;
  readonly finance?: {
    readonly received30dMinor: number;
    readonly refunded30dMinor: number;
    readonly receivedYearMinor: number;
    readonly monthlyPlanValueMinor: number;
    readonly pendingRefunds: number;
    readonly pendingReceipts: number;
    readonly pendingPayments: number;
    readonly usageReview: number;
    readonly daily: readonly { readonly date: string; readonly amountMinor: number; readonly payments: number }[];
  };
  readonly paymentProviders: readonly BillingProviderAvailability[];
  readonly degraded: readonly ("SEO" | "EXECUTION")[];
}
