import type { JobCapacityEntitlement, SemanticCapacityEntitlement } from "./billing.js";
import type { ConnectorOperationAttemptSummary, ConnectorRoutingScope } from "./integrations.js";
import type { SemanticKeywordBulkSelection } from "./keywords.js";
import type { OperationResultPageInfo } from "./operation-results.js";

export const arsenkinClusteringKeywordLimit = 300_000 as const;
export const internalClusteringResolveBatchLimit = 1_000 as const;
export const internalClusteringPersistItemLimit = 300_000 as const;
export const clusteringProposalUnclusteredSectionId = "unclustered" as const;

export const clusteringSearchEngines = ["YANDEX", "GOOGLE"] as const;
export type ClusteringSearchEngine = (typeof clusteringSearchEngines)[number];

export const clusteringMethods = ["SOFT", "HARD"] as const;
export type ClusteringMethod = (typeof clusteringMethods)[number];

export const clusteringDepths = [10, 20, 30] as const;
export type ClusteringDepth = (typeof clusteringDepths)[number];

export const clusteringFrequencyTypes = [
  "BASE",
  "QUOTED",
  "OVERALL",
  "EXACT"
] as const;
export type ClusteringFrequencyType =
  (typeof clusteringFrequencyTypes)[number];

export const clusteringRunStatuses = [
  "QUEUED",
  "RUNNING",
  "WAITING_RATE_LIMIT",
  "RETRY_SCHEDULED",
  "ACTION_REQUIRED",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "PARTIALLY_COMPLETED",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL"
] as const;
export type ClusteringRunStatus = (typeof clusteringRunStatuses)[number];

export interface CreateClusteringRunInput {
  readonly items: readonly SemanticKeywordBulkSelection[];
  readonly searchEngine: ClusteringSearchEngine;
  readonly regionCode: string;
  readonly method: ClusteringMethod;
  readonly overlapCount: number;
  readonly depth: ClusteringDepth;
  readonly excludeMainPages: boolean;
  readonly stopDomains: readonly string[];
  readonly frequencyTypes: readonly ClusteringFrequencyType[];
  readonly replaceExistingClusters: boolean;
}

export interface InternalCreateClusteringRunInput
  extends CreateClusteringRunInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly jobCapacity: JobCapacityEntitlement;
}

export interface InternalCancelClusteringRunInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface ClusteringRunSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId?: string;
  readonly provider: "ARSENKIN";
  readonly routingScope?: ConnectorRoutingScope;
  readonly connectorAttempts?: readonly ConnectorOperationAttemptSummary[];
  readonly status: ClusteringRunStatus;
  readonly stage?: string;
  readonly selectedKeywords: number;
  readonly completedKeywords: number;
  readonly failedKeywords: number;
  readonly searchEngine: ClusteringSearchEngine;
  readonly regionCode: string;
  readonly method: ClusteringMethod;
  readonly overlapCount: number;
  readonly depth: ClusteringDepth;
  readonly excludeMainPages: boolean;
  readonly stopDomains: readonly string[];
  readonly frequencyTypes: readonly ClusteringFrequencyType[];
  readonly replaceExistingClusters: boolean;
  readonly proposalId?: string;
  readonly clusterCount?: number;
  readonly unclusteredCount?: number;
  readonly retryAt?: string;
  readonly failureCode?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface InternalResolveClusteringKeywordsInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly items: readonly SemanticKeywordBulkSelection[];
}

export interface InternalClusteringKeyword {
  readonly id: string;
  readonly text: string;
  readonly version: number;
}

export interface InternalClusteringKeywords {
  readonly items: readonly InternalClusteringKeyword[];
}

export interface InternalClusteringProposalClusterInput {
  readonly sequence: number;
  readonly providerKey: string;
  readonly name: string;
  readonly topUrl?: string;
  readonly topUrls: readonly ClusteringProposalTopUrl[];
  readonly frequencySum?: string;
  readonly mainPageCount?: number;
}

export interface ClusteringProposalTopUrl {
  readonly url: string;
  /** Number of cluster queries for which the URL was found, when provided. */
  readonly overlapCount?: number;
}

export interface InternalClusteringProposalItemInput {
  readonly sequence: number;
  readonly keywordId: string;
  readonly keywordVersion: number;
  readonly keywordText: string;
  readonly clusterSequence?: number;
  readonly frequency?: string;
  readonly exactFrequency?: string;
  readonly aggregatorsPercent?: number;
  readonly toponym?: string;
  readonly geoDependent?: boolean;
}

export interface InternalPersistClusteringProposalInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly provider: "ARSENKIN";
  readonly connectorVersion: string;
  readonly parameters: Omit<CreateClusteringRunInput, "items">;
  readonly clusters: readonly InternalClusteringProposalClusterInput[];
  readonly items: readonly InternalClusteringProposalItemInput[];
}

export const clusteringProposalStatuses = ["READY", "APPLIED", "REJECTED"] as const;
export type ClusteringProposalStatus =
  (typeof clusteringProposalStatuses)[number];

export interface ClusteringProposalSummary {
  readonly id: string;
  readonly jobId: string;
  readonly status: ClusteringProposalStatus;
  readonly keywordCount: number;
  readonly clusterCount: number;
  readonly unclusteredCount: number;
  readonly readyCount: number;
  readonly protectedCount: number;
  readonly conflictedCount: number;
  readonly appliedKeywordCount: number;
  readonly createdGroupCount: number;
  readonly semanticVersionIds: readonly string[];
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly appliedAt?: string;
  readonly rejectedAt?: string;
}

export const clusteringProposalItemStates = [
  "READY",
  "UNCHANGED",
  "LOCKED",
  "EXCLUDED",
  "CONFLICTED",
  "UNAVAILABLE"
] as const;
export type ClusteringProposalItemState =
  (typeof clusteringProposalItemStates)[number];

export const clusteringProposalConflictReasons = [
  "KEYWORD_CHANGED"
] as const;
export type ClusteringProposalConflictReason =
  (typeof clusteringProposalConflictReasons)[number];

export interface ClusteringProposalClusterSummary {
  readonly id: string;
  readonly sequence: number;
  readonly name: string;
  readonly keywordCount: number;
  /** Queries in this proposal cluster that currently belong to an active SEO cluster. */
  readonly currentClusterKeywordCount: number;
  readonly topUrl?: string;
  readonly topUrls: readonly ClusteringProposalTopUrl[];
  readonly frequencySum?: string;
  readonly mainPageCount?: number;
}

export interface ClusteringProposalResultRow {
  readonly sequence: number;
  readonly keywordId: string;
  readonly keyword: string;
  readonly state: ClusteringProposalItemState;
  readonly conflictReason?: ClusteringProposalConflictReason;
  readonly currentClusterName?: string;
  readonly proposedCluster?: ClusteringProposalClusterSummary;
  readonly frequency?: string;
  readonly exactFrequency?: string;
  readonly aggregatorsPercent?: number;
  readonly toponym?: string;
  readonly geoDependent?: boolean;
}

export interface ClusteringOperationResult {
  readonly run: ClusteringRunSummary;
  readonly proposal?: ClusteringProposalSummary;
  readonly clusters: readonly ClusteringProposalClusterSummary[];
  readonly rows: readonly ClusteringProposalResultRow[];
  readonly page: OperationResultPageInfo;
}

/** A cursor page for one proposal cluster, loaded independently from the summary. */
export interface ClusteringProposalSectionResult {
  /** Proposal cluster UUID or the stable `unclustered` section key. */
  readonly sectionId: string;
  readonly rows: readonly ClusteringProposalResultRow[];
  readonly page: OperationResultPageInfo;
}

export const clusteringFolderModes = ["NONE", "CREATE_SUBGROUPS"] as const;
export type ClusteringFolderMode = (typeof clusteringFolderModes)[number];
export const clusteringClusterFolderActions = ["NEW", "KEEP", "EXISTING"] as const;
export type ClusteringClusterFolderAction =
  (typeof clusteringClusterFolderActions)[number];
export const clusteringClusterAssignmentActions = ["NEW", "KEEP", "EXISTING"] as const;
export type ClusteringClusterAssignmentAction =
  (typeof clusteringClusterAssignmentActions)[number];

export interface ApplyClusteringProposalInput {
  readonly proposalVersion: number;
  readonly excludedClusterIds: readonly string[];
  readonly clusterNameOverrides: readonly {
    readonly proposalClusterId: string;
    readonly name: string;
  }[];
  /** Per proposal cluster SEO-cluster destination, independent from its folder destination. */
  readonly clusterAssignmentOverrides: readonly {
    readonly proposalClusterId: string;
    readonly action: ClusteringClusterAssignmentAction;
    readonly clusterId?: string;
  }[];
  /** Explicit existing-folder destinations for individual proposal rows. */
  readonly keywordGroupOverrides: readonly {
    readonly keywordId: string;
    readonly groupId: string;
  }[];
  /** Per-cluster destination: create under a parent, move to an existing folder, or keep memberships. */
  readonly clusterFolderOverrides: readonly {
    readonly proposalClusterId: string;
    readonly action: ClusteringClusterFolderAction;
    readonly groupId?: string;
    readonly parentGroupId?: string;
  }[];
  readonly folderMode: ClusteringFolderMode;
  readonly parentGroupId?: string;
  readonly createUnclusteredGroup: boolean;
}

export interface InternalApplyClusteringProposalInput
  extends ApplyClusteringProposalInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly entitlement: SemanticCapacityEntitlement;
}

export interface InternalRejectClusteringProposalInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly proposalVersion: number;
}

export interface ClusteringProposalApplyResult {
  readonly proposal: ClusteringProposalSummary;
  readonly createdClusterCount: number;
  readonly createdGroupCount: number;
  readonly appliedKeywordCount: number;
  readonly skippedKeywordCount: number;
  readonly conflictedKeywordCount: number;
  readonly semanticVersionIds: readonly string[];
}

export interface InternalClusteringProposalResultInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly limit: number;
  readonly cursor?: number;
}

export interface InternalClusteringProposalSectionResultInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly jobId: string;
  readonly sectionId: string;
  readonly limit: number;
  readonly cursor?: number;
}

export interface InternalClusteringProposalResult {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly proposal?: ClusteringProposalSummary;
  readonly clusters: readonly ClusteringProposalClusterSummary[];
  readonly rows: readonly ClusteringProposalResultRow[];
  readonly page: OperationResultPageInfo;
}

export interface InternalClusteringProposalSectionResult
  extends ClusteringProposalSectionResult {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly jobId: string;
}
