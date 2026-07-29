import type {
  TrackingContextConfigurationInput,
  TrackingContextStatus
} from "./tracking-contexts.js";

export const rankEstimateStatuses = ["READY", "BLOCKED"] as const;

export type RankEstimateStatus = (typeof rankEstimateStatuses)[number];

export const rankEstimateProviders = ["ARSENKIN"] as const;

export type RankEstimateProvider = (typeof rankEstimateProviders)[number];

export const rankEstimateOperations = ["POSITIONS"] as const;

export type RankEstimateOperation = (typeof rankEstimateOperations)[number];

export const rankEstimateCredentialModes = ["BYOK_API_KEY"] as const;

export type RankEstimateCredentialMode =
  (typeof rankEstimateCredentialModes)[number];

export const rankEstimateScopeHashAvailabilities = [
  "AVAILABLE",
  "UNAVAILABLE"
] as const;

export type RankEstimateScopeHashAvailability =
  (typeof rankEstimateScopeHashAvailabilities)[number];

export type RankEstimateScopeHash =
  | {
      readonly availability: "AVAILABLE";
      readonly algorithm: "SHA_256";
      readonly value: string;
    }
  | {
      readonly availability: "UNAVAILABLE";
    };

export const rankEstimateBlockerCodes = [
  "CONTEXT_ARCHIVED",
  "NO_ASSIGNED_KEYWORDS",
  "KEYWORD_LIMIT_EXCEEDED",
  "SCOPE_HASH_UNAVAILABLE",
  "UNSUPPORTED_SEARCH_ENGINE",
  "UNSUPPORTED_DEPTH",
  "COUNTRY_MAPPING_UNVERIFIED",
  "REGION_MAPPING_UNVERIFIED",
  "LANGUAGE_MAPPING_UNVERIFIED",
  "SAFE_SEARCH_MAPPING_UNVERIFIED",
  "DOMAIN_MAPPING_UNVERIFIED",
  "BINDING_NOT_CONFIGURED",
  "BINDING_DISABLED",
  "BINDING_NOT_READY",
  "BINDING_ROUTE_UNSUPPORTED",
  "CREDENTIAL_NOT_ACTIVE",
  "CREDENTIAL_NOT_FRESH",
  "CREDENTIAL_PROVIDER_MISMATCH",
  "CREDENTIAL_MODE_UNSUPPORTED",
  "PROVIDER_CONTRACT_NOT_READY",
  "PROVIDER_EXECUTION_DISABLED",
  "ENTITLEMENT_NOT_AVAILABLE",
  "ENTITLEMENT_DENIED",
  "QUOTA_EXCEEDED",
  "MISSING_RUN_PERMISSION",
  "WORKSPACE_READ_ONLY",
  "WORKSPACE_SUSPENDED",
  "PROJECT_NOT_ACTIVE",
  "PROJECT_ARCHIVED"
] as const;

export type RankEstimateBlockerCode =
  (typeof rankEstimateBlockerCodes)[number];

export interface RankEstimateBlocker {
  readonly code: RankEstimateBlockerCode;
}

export const rankEstimateQuotaStatuses = [
  "AVAILABLE",
  "EXHAUSTED",
  "NOT_AVAILABLE"
] as const;

export type RankEstimateQuotaStatus =
  (typeof rankEstimateQuotaStatuses)[number];

export type RankEstimateQuota =
  | {
      readonly status: "AVAILABLE";
      readonly limit: string;
      readonly used: string;
      readonly remaining: string;
      readonly resetsAt?: string;
    }
  | {
      readonly status: "EXHAUSTED";
      readonly limit: string;
      readonly used: string;
      readonly remaining: string;
      readonly resetsAt?: string;
    }
  | {
      readonly status: "NOT_AVAILABLE";
    };

export const rankEstimateCredentialFreshnessStatuses = [
  "FRESH",
  "STALE",
  "UNVERIFIED",
  "NOT_AVAILABLE"
] as const;

export type RankEstimateCredentialFreshnessStatus =
  (typeof rankEstimateCredentialFreshnessStatuses)[number];

export type RankEstimateCredentialFreshness =
  | {
      readonly status: "FRESH";
      readonly verifiedAt: string;
    }
  | {
      readonly status: "STALE";
      readonly verifiedAt?: string;
    }
  | {
      readonly status: "UNVERIFIED" | "NOT_AVAILABLE";
    };

export const rankEstimateEntitlementStatuses = [
  "ALLOWED",
  "DENIED",
  "NOT_AVAILABLE"
] as const;

export type RankEstimateEntitlementStatus =
  (typeof rankEstimateEntitlementStatuses)[number];

export interface CreateRankEstimateInput {
  readonly trackingContextId: string;
}

/**
 * Authoritative project snapshot loaded by Platform API. Jobs must not trust
 * project lifecycle or domain values supplied by a browser.
 */
export interface InternalRankEstimateProjectSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly domain: string;
  readonly status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  readonly version: number;
}

/**
 * Point-in-time access projection. It is an estimate input, not an execution
 * grant: a future run must re-check every mutable authorization decision.
 */
export interface InternalRankEstimateAccessSnapshot {
  readonly workspaceStatus: "ACTIVE" | "READ_ONLY" | "SUSPENDED";
  readonly canRunRanking: boolean;
  readonly entitlementStatus: RankEstimateEntitlementStatus;
}

export interface InternalCreateRankEstimateInput
  extends CreateRankEstimateInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly project: InternalRankEstimateProjectSnapshot;
  readonly access: InternalRankEstimateAccessSnapshot;
  readonly billingCurrency: string;
  readonly quota: RankEstimateQuota;
}

export interface InternalRankEstimateScopeQuery {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly trackingContextId: string;
}

/**
 * Bounded SEO Data projection used to calculate an estimate. Keyword text and
 * keyword IDs intentionally never cross this boundary.
 */
export interface InternalRankEstimateScope {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly trackingContextId: string;
  readonly contextStatus: TrackingContextStatus;
  readonly contextVersion: number;
  readonly configurationVersion: number;
  readonly configurationHash: string;
  readonly configuration: TrackingContextConfigurationInput;
  /**
   * Exact values through 1,000. The value "1001" is a bounded overflow
   * sentinel meaning "at least 1,001", not an exact total.
   */
  readonly keywordCount: string;
  readonly contextCount: "1";
  /**
   * Uses the same bounded overflow sentinel semantics as keywordCount.
   */
  readonly pairCount: string;
  readonly semanticScopeHash: RankEstimateScopeHash;
  readonly calculatedAt: string;
}

export interface RankEstimateScopeSummary {
  readonly keywordCount: string;
  readonly contextCount: "1";
  readonly pairCount: string;
  readonly scopeHash: RankEstimateScopeHash;
  /** Logical context revision; never lower than configurationVersion. */
  readonly contextVersion: number;
  readonly configurationVersion: number;
}

export interface RankEstimateProviderWorkload {
  readonly taskCount: string;
  readonly minimumRequestCount: string;
  readonly pollingRequestCount: {
    readonly status: "NOT_AVAILABLE";
  };
  readonly requestStages: readonly ["SET", "CHECK", "GET"];
  readonly keywordLimitPerTask: "250";
  readonly keywordLimitPerCommand: "1000";
  readonly format: "SIMPLE";
  readonly rawSerp: false;
  readonly fallbackMode: "NONE";
}

export interface RankEstimateRetention {
  readonly normalizedRankHistory: "LONG_TERM";
  readonly rawSerp: "NOT_COLLECTED";
}

export interface RankEstimateProviderLimits {
  readonly status: "NOT_AVAILABLE";
}

export interface RankEstimateExpectedDuration {
  readonly status: "NOT_AVAILABLE";
}

/**
 * Public immutable estimate. Credential/binding/material identifiers,
 * project domain and provider payloads are deliberately absent.
 */
export interface RankEstimate {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly trackingContextId: string;
  readonly status: RankEstimateStatus;
  readonly provider: RankEstimateProvider;
  readonly operation: RankEstimateOperation;
  readonly credentialMode: RankEstimateCredentialMode;
  readonly scope: RankEstimateScopeSummary;
  readonly workload: RankEstimateProviderWorkload;
  readonly providerLimits: RankEstimateProviderLimits;
  readonly expectedDuration: RankEstimateExpectedDuration;
  readonly platformChargeMicro: "0";
  readonly billingCurrency: string;
  readonly quota: RankEstimateQuota;
  readonly credentialFreshness: RankEstimateCredentialFreshness;
  readonly retention: RankEstimateRetention;
  readonly blockers: readonly RankEstimateBlocker[];
  readonly executionAllowed: boolean;
  readonly policyVersion: string;
  readonly calculatedAt: string;
  readonly expiresAt: string;
}
