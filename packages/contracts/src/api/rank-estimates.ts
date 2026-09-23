import type {
  TrackingContextConfigurationInput,
  TrackingContextStatus,
  TrackingSearchSource
} from "./tracking-contexts.js";
import { trackingSearchSources } from "./tracking-contexts.js";
import type {
  ConnectorOperationAttemptSummary,
  ConnectorRoutingScope,
  XmlStockOperationUsageSummary
} from "./integrations.js";
import { batchedArsenkinRankPolicyVersion, largeXmlStockRankPolicyVersion } from "./rank-policy.js";

export const rankEstimateStatuses = ["READY", "BLOCKED"] as const;

export type RankEstimateStatus = (typeof rankEstimateStatuses)[number];

export const rankEstimateProviders = ["ARSENKIN", "XMLSTOCK"] as const;

export type RankEstimateProvider = (typeof rankEstimateProviders)[number];

export const rankSearchSources = trackingSearchSources;

export type RankSearchSource = TrackingSearchSource;

export const rankCollectionPurposes = [
  "POSITION_TRACKING",
  "COMPETITOR_SERP"
] as const;

export type RankCollectionPurpose =
  (typeof rankCollectionPurposes)[number];

/**
 * Optional paid execution mode for XMLStock Yandex Live. Absence always
 * means the standard Live mode, so old clients keep their exact behaviour.
 */
export const rankYandexLiveModes = ["TURBO"] as const;

export type RankYandexLiveMode = (typeof rankYandexLiveModes)[number];

export const rankEstimateOperations = ["POSITIONS"] as const;

export type RankEstimateOperation = (typeof rankEstimateOperations)[number];

export const rankEstimateCredentialModes = [
  "BYOK_API_KEY",
  "PLATFORM_PAID"
] as const;

export type RankEstimateCredentialMode =
  (typeof rankEstimateCredentialModes)[number];

/**
 * Arsenkin positions accepts one provider task per launch. The production
 * contract uses the largest published Corporate launch size and deliberately
 * does not split a command behind the user's back: a smaller provider plan is
 * expected to reject the single task with a provider-facing error.
 */
export const rankProviderKeywordLimit = 15_000 as const;
export const rankProviderOverflowCount = 15_001 as const;
export const rankManifestSingleTaskChunkSize = 15_000 as const;

/**
 * Highest per-keyword price that keeps a full 15k paid launch inside a
 * signed PostgreSQL BIGINT after converting minor units to 1/10,000 units.
 */
export const maximumPlatformRankKeywordPriceMinor = 61_489_146_912 as const;

/** Read-only compatibility for immutable runs sealed before the 15k policy. */
export const legacyRankProviderKeywordLimit = 1_000 as const;
export const legacyRankManifestChunkSize = 250 as const;

export const legacyRankProviderPolicyVersion =
  "manual-arsenkin-positions@1.0.0" as const;
export const currentRankProviderPolicyVersion =
  "manual-arsenkin-positions@2.0.0" as const;
export const xmlStockRankProviderPolicyVersion =
  "manual-xmlstock-serp@1.0.0" as const;
export const xmlStockRankManifestChunkSize = 1 as const;

export const supportedRankProviderPolicyVersions = [
  legacyRankProviderPolicyVersion,
  currentRankProviderPolicyVersion,
  xmlStockRankProviderPolicyVersion,
  batchedArsenkinRankPolicyVersion,
  largeXmlStockRankPolicyVersion
] as const;

export type RankProviderPolicyVersion =
  (typeof supportedRankProviderPolicyVersions)[number];

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
  "UNLIMITED",
  "AVAILABLE",
  "EXHAUSTED",
  "NOT_AVAILABLE"
] as const;

export type RankEstimateQuotaStatus =
  (typeof rankEstimateQuotaStatuses)[number];

export type RankEstimateQuota =
  | {
      readonly status: "UNLIMITED";
    }
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
  /** Omitted by legacy clients and treated as POSITION_TRACKING. */
  readonly purpose?: RankCollectionPurpose;
  /** For competitor SERP only: project position may be reused from the same TOP-10. */
  readonly saveProjectPosition?: boolean;
  /** Explicit execution provider selected for this immutable launch. */
  readonly provider?: RankEstimateProvider;
  /**
   * Exact configured BYOK connection selected for this immutable launch.
   * The connection must belong to the effective project routing chain.
   */
  readonly credentialId?: string;
  /** Provider SERP family sealed into the immutable estimate. */
  readonly searchSource?: RankSearchSource;
  /** Paid XMLStock Yandex Live mode selected for this immutable launch. */
  readonly yandexLiveMode?: RankYandexLiveMode;
  /** XMLStock Live paging: exact depth or stop after the first project match. */
  readonly xmlStockDepthMode?: "STRICT_DEPTH" | "STOP_AFTER_FOUND";
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

/** Trusted, immutable workload for Core pricing; contains no credential material. */
export interface InternalRankEstimatePricingScope {
  readonly estimateId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly provider: RankEstimateProvider;
  readonly credentialMode: RankEstimateCredentialMode;
  readonly keywordCount: number;
  readonly execution: {
    readonly purpose: RankCollectionPurpose;
    readonly depth: number;
    readonly source: "GOOGLE_LIVE" | "YANDEX_LIVE" | "YANDEX_TURBO" | "YANDEX_SEARCH_API";
  } | null;
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
   * Exact values through 15,000. The value "15001" is a bounded overflow
   * sentinel meaning "at least 15,001", not an exact total.
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
  readonly requestStages:
    | readonly ["SET", "CHECK", "GET"]
    | readonly ["SUBMIT", "POLL"]
    | readonly ["GET"];
  /** New estimates use 15000; 250 remains representable for stored v1 runs. */
  readonly keywordLimitPerTask: "1" | "250" | "5000" | "15000";
  /** New estimates use 15000; 1000 remains representable for stored v1 runs. */
  readonly keywordLimitPerCommand: "1000" | "15000" | "300000";
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
  /** Present on new estimates; missing legacy values mean POSITION_TRACKING. */
  readonly purpose?: RankCollectionPurpose;
  readonly saveProjectPosition?: boolean;
  /** Safe provenance of the effective workspace/project route. */
  readonly routingScope?: ConnectorRoutingScope;
  /** Bounded, secret-free route decisions made before provider submission. */
  readonly connectorAttempts?: readonly ConnectorOperationAttemptSummary[];
  readonly operation: RankEstimateOperation;
  readonly credentialMode: RankEstimateCredentialMode;
  readonly scope: RankEstimateScopeSummary;
  readonly workload: RankEstimateProviderWorkload;
  readonly providerLimits: RankEstimateProviderLimits;
  readonly expectedDuration: RankEstimateExpectedDuration;
  readonly providerUsage?: XmlStockOperationUsageSummary;
  readonly platformChargeMicro: string;
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
