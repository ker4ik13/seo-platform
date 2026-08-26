export const trackingContextStatuses = ["ACTIVE", "ARCHIVED"] as const;

export type TrackingContextStatus =
  (typeof trackingContextStatuses)[number];

export const trackingSearchEngines = ["GOOGLE", "YANDEX"] as const;

export type TrackingSearchEngine =
  (typeof trackingSearchEngines)[number];

export const trackingSearchSources = ["SEARCH_API", "LIVE"] as const;

export type TrackingSearchSource =
  (typeof trackingSearchSources)[number];

export const trackingContextScopeModes = [
  "ALL",
  "GROUPS",
  "KEYWORDS"
] as const;

export type TrackingContextScopeMode =
  (typeof trackingContextScopeModes)[number];

/**
 * Editable launch defaults for a logical tracking context. The exact keyword
 * assignments remain authoritative for an immutable run; folder identifiers
 * only describe how the next desired set must be materialized.
 */
export interface TrackingContextLaunchProfile {
  readonly searchSource: TrackingSearchSource;
  /** Include keywords whose per-keyword tracking flag is disabled. */
  readonly includeUntracked: boolean;
  readonly scope: {
    readonly mode: TrackingContextScopeMode;
    readonly groupIds: readonly string[];
  };
}

export const trackingDevices = ["DESKTOP", "MOBILE"] as const;

export type TrackingDevice = (typeof trackingDevices)[number];

export const trackingDepths = [30, 50, 100] as const;

export type TrackingDepth = (typeof trackingDepths)[number];

export const trackingDomainMatchModes = [
  "EXACT_HOST",
  "INCLUDE_WWW",
  "INCLUDE_SUBDOMAINS",
  "CANONICAL_DOMAIN",
  "ANY_PROJECT_MIRROR",
  "SPECIFIC_URL",
  "URL_PREFIX"
] as const;

export type TrackingDomainMatchMode =
  (typeof trackingDomainMatchModes)[number];

export type TrackingDomainMatchRule =
  | {
      readonly mode: Exclude<
        TrackingDomainMatchMode,
        "SPECIFIC_URL" | "URL_PREFIX"
      >;
    }
  | {
      readonly mode: "SPECIFIC_URL" | "URL_PREFIX";
      readonly value: string;
    };

export interface TrackingContextConfigurationInput {
  readonly searchEngine: TrackingSearchEngine;
  readonly countryCode: string;
  readonly regionCode?: string;
  readonly regionLabel?: string;
  readonly language: string;
  readonly device: TrackingDevice;
  readonly depth: TrackingDepth;
  readonly domainMatchRule: TrackingDomainMatchRule;
  readonly safeSearch: boolean;
}

export interface TrackingContextConfigurationSnapshot
  extends TrackingContextConfigurationInput {
  readonly configurationVersion: number;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface TrackingContextSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly name: string;
  readonly status: TrackingContextStatus;
  readonly configuration: TrackingContextConfigurationSnapshot;
  readonly launchProfile?: TrackingContextLaunchProfile;
  readonly assignedKeywordCount: number;
  readonly version: number;
  readonly createdBy: string;
  readonly updatedBy: string;
  readonly archivedBy?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

export interface TrackingContextCollection {
  readonly contexts: readonly TrackingContextSummary[];
  readonly contextsTruncated: boolean;
}

export const trackingContextMutationRestrictions = [
  "NONE",
  "MISSING_PERMISSION",
  "WORKSPACE_READ_ONLY",
  "PROJECT_ARCHIVED"
] as const;

export type TrackingContextMutationRestriction =
  (typeof trackingContextMutationRestrictions)[number];

export interface TrackingContextAccess {
  readonly canConfigure: boolean;
  readonly mutationRestriction: TrackingContextMutationRestriction;
}

export interface TrackingContextSettings extends TrackingContextCollection {
  readonly access: TrackingContextAccess;
}

export interface CreateTrackingContextInput {
  readonly name: string;
  readonly configuration: TrackingContextConfigurationInput;
  readonly launchProfile?: TrackingContextLaunchProfile;
}

export interface InternalCreateTrackingContextInput
  extends CreateTrackingContextInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
}

export interface UpdateTrackingContextInput {
  readonly name: string;
  readonly configuration: TrackingContextConfigurationInput;
  readonly launchProfile?: TrackingContextLaunchProfile;
}

export interface InternalUpdateTrackingContextInput
  extends UpdateTrackingContextInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface InternalChangeTrackingContextStatusInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface TrackingContextKeywordQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
}

/** Bounded page size for lightweight tracking-context assignments. */
export const trackingContextKeywordPageLimit = 1_000 as const;

export interface TrackingContextKeywordAssignmentItem {
  readonly assignmentId: string;
  readonly contextId: string;
  readonly keywordId: string;
  readonly keywordVersion: number;
  readonly textOriginal: string;
  readonly language: string;
  readonly isTracked: boolean;
  readonly assignedBy: string;
  readonly assignedAt: string;
}

export interface TrackingContextKeywordAssignmentState {
  readonly contextId: string;
  readonly keywordId: string;
  readonly assigned: boolean;
  readonly assignmentId?: string;
  readonly changedAt?: string;
}

/** Maximum exact desired set accepted by one Arsenkin positions launch. */
export const trackingContextKeywordReplacementLimit = 15_000 as const;

export interface ReplaceTrackingContextKeywordsInput {
  readonly keywordIds: readonly string[];
}

export interface InternalReplaceTrackingContextKeywordsInput
  extends ReplaceTrackingContextKeywordsInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly contextId: string;
  readonly actorId: string;
  readonly version: number;
  readonly idempotencyKey: string;
  readonly entitlement: import("./billing.js").SemanticCapacityEntitlement;
}

export interface TrackingContextKeywordReplacementResult {
  readonly contextId: string;
  readonly assignedKeywordCount: number;
  readonly addedKeywordCount: number;
  readonly removedKeywordCount: number;
  readonly unchangedKeywordCount: number;
  readonly keywordSetHash: {
    readonly algorithm: "SHA_256";
    readonly value: string;
  };
  readonly version: number;
  readonly changedAt: string;
}

export interface InternalChangeTrackingContextKeywordInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly contextId: string;
  readonly keywordId: string;
  readonly actorId: string;
  readonly entitlement: import("./billing.js").SemanticCapacityEntitlement;
}
