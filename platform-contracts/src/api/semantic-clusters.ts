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
  readonly primaryPageId?: string;
  readonly pageMappingSource?: SemanticClusterPageSource;
  readonly pageMappingConfidence?: number;
  readonly pageMappingRationale?: string;
}

export interface UpdateSemanticClusterInput {
  readonly name: string;
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
import type { PageIndexability, PageType } from "./pages.js";
