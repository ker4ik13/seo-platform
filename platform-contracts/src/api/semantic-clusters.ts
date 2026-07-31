import type { PageIndexability, PageType } from "./pages.js";

export const semanticClusterMethods = ["MANUAL"] as const;

export type SemanticClusterMethod =
  (typeof semanticClusterMethods)[number];

export const semanticClusterPageSources = [
  "MANUAL",
  "IMPORTED",
  "RULE",
  "AI",
  "SERP"
] as const;

export type SemanticClusterPageSource =
  (typeof semanticClusterPageSources)[number];

export interface SemanticClusterPrimaryPage {
  readonly id: string;
  readonly url: string;
  readonly normalizedUrl: string;
  readonly pageType: PageType;
  readonly indexability: PageIndexability;
}

export interface SemanticClusterPageDiagnostics {
  readonly mappedKeywordCount: number;
  readonly unmappedKeywordCount: number;
  readonly competingPageCount: number;
  readonly hasCannibalization: boolean;
  readonly hasMissingLanding: boolean;
}

export interface SemanticCluster {
  readonly id: string;
  readonly name: string;
  readonly method: SemanticClusterMethod;
  readonly keywordCount: number;
  readonly isLocked: boolean;
  readonly excludeFromReclustering: boolean;
  readonly primaryPage?: SemanticClusterPrimaryPage;
  readonly pageMappingSource?: SemanticClusterPageSource;
  readonly pageMappingConfidence?: number;
  readonly pageMappingRationale?: string;
  readonly pageDiagnostics: SemanticClusterPageDiagnostics;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateSemanticClusterInput {
  readonly name: string;
  readonly isLocked?: boolean;
  readonly excludeFromReclustering?: boolean;
  readonly primaryPageId?: string;
  readonly pageMappingSource?: SemanticClusterPageSource;
  readonly pageMappingConfidence?: number;
  readonly pageMappingRationale?: string;
}

export interface UpdateSemanticClusterInput {
  readonly name: string;
  readonly isLocked?: boolean;
  readonly excludeFromReclustering?: boolean;
  readonly primaryPageId?: string | null;
  readonly pageMappingSource?: SemanticClusterPageSource;
  readonly pageMappingConfidence?: number;
  readonly pageMappingRationale?: string;
}

export interface InternalCreateSemanticClusterInput
  extends CreateSemanticClusterInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface InternalUpdateSemanticClusterInput
  extends UpdateSemanticClusterInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface InternalDeleteSemanticClusterInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface SemanticClusterPageBulkSelection {
  readonly id: string;
  readonly version: number;
}

export interface SemanticClusterPageBulkInput {
  readonly items: readonly SemanticClusterPageBulkSelection[];
  readonly primaryPageId: string | null;
  readonly pageMappingSource?: SemanticClusterPageSource;
  readonly pageMappingConfidence?: number;
  readonly pageMappingRationale?: string;
}

export interface InternalSemanticClusterPageBulkInput
  extends SemanticClusterPageBulkInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export const semanticClusterPageBulkStates = [
  "APPLICABLE",
  "UNCHANGED",
  "CONFLICTED",
  "UNAVAILABLE"
] as const;

export type SemanticClusterPageBulkState =
  (typeof semanticClusterPageBulkStates)[number];

export interface SemanticClusterPageBulkPreviewChange {
  readonly clusterId: string;
  readonly state: SemanticClusterPageBulkState;
  readonly expectedVersion: number;
  readonly currentVersion?: number;
  readonly currentPrimaryPageId?: string;
  readonly targetPrimaryPageId?: string;
}

export interface SemanticClusterPageBulkPreview {
  readonly selected: number;
  readonly applicable: number;
  readonly skipped: number;
  readonly conflicted: number;
  readonly changes: readonly SemanticClusterPageBulkPreviewChange[];
}

export interface SemanticClusterPageBulkResult {
  readonly selected: number;
  readonly changed: number;
  readonly skipped: number;
  readonly conflicted: number;
  readonly updatedClusters: readonly SemanticCluster[];
  readonly skippedIds: readonly string[];
  readonly conflictedIds: readonly string[];
}

export interface SemanticClusterVersionSelection {
  readonly id: string;
  readonly version: number;
}

export interface SemanticClusterMergeInput {
  readonly items: readonly SemanticClusterVersionSelection[];
  readonly targetClusterId: string;
}

export interface InternalSemanticClusterMergeInput
  extends SemanticClusterMergeInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export const semanticClusterMergeReadiness = [
  "READY",
  "CONFLICTED",
  "BACKGROUND_REQUIRED"
] as const;

export type SemanticClusterMergeReadiness =
  (typeof semanticClusterMergeReadiness)[number];

export interface SemanticClusterMergePreview {
  readonly readiness: SemanticClusterMergeReadiness;
  readonly selectedClusterCount: number;
  readonly sourceClusterCount: number;
  readonly movedKeywordCount: number;
  readonly sourcePageConflictCount: number;
  readonly lockedClusterCount: number;
  readonly conflictedIds: readonly string[];
  readonly unavailableIds: readonly string[];
  readonly synchronousKeywordLimit: number;
}

export interface SemanticClusterMergeResult {
  readonly targetCluster: SemanticCluster;
  readonly mergedClusterIds: readonly string[];
  readonly movedKeywordCount: number;
}
