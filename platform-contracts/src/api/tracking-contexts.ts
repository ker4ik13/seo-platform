export const trackingContextStatuses = ["ACTIVE", "ARCHIVED"] as const;

export type TrackingContextStatus =
  (typeof trackingContextStatuses)[number];

export const trackingSearchEngines = ["GOOGLE", "YANDEX"] as const;

export type TrackingSearchEngine =
  (typeof trackingSearchEngines)[number];

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

export interface TrackingContextKeywordAssignmentItem {
  readonly assignmentId: string;
  readonly contextId: string;
  readonly keywordId: string;
  readonly textOriginal: string;
  readonly language: string;
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

export interface InternalChangeTrackingContextKeywordInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly contextId: string;
  readonly keywordId: string;
  readonly actorId: string;
  readonly entitlement: import("./billing.js").SemanticCapacityEntitlement;
}
