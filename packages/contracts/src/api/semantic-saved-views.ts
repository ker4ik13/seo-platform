import type {
  SemanticKeywordIntent,
  SemanticKeywordSort
} from "./keywords.js";

export const semanticSavedViewScopes = [
  "PRIVATE",
  "PROJECT_SHARED"
] as const;

export type SemanticSavedViewScope =
  (typeof semanticSavedViewScopes)[number];

export const semanticSavedViewDensities = [
  "COMFORTABLE",
  "COMPACT"
] as const;

export type SemanticSavedViewDensity =
  (typeof semanticSavedViewDensities)[number];

export const semanticSystemColumnKeys = [
  "query",
  "frequency",
  "frequencyExact",
  "frequencyFixed",
  "wordCount",
  "yandexPosition",
  "googlePosition",
  "yandexRelevantUrl",
  "googleRelevantUrl",
  "yandexCheckedAt",
  "googleCheckedAt",
  "visibility",
  "group",
  "cluster",
  "targetUrl",
  "tags",
  "intent",
  "priority",
  "source",
  "updatedAt"
] as const;

export type SemanticSystemColumnKey =
  (typeof semanticSystemColumnKeys)[number];

export type SemanticSavedViewColumnKey =
  | SemanticSystemColumnKey
  | `custom:${string}`;

export interface SemanticSavedViewFilters {
  readonly search?: string;
  readonly tag?: string;
  readonly intent?: SemanticKeywordIntent;
  readonly groupId?: string;
  readonly clusterId?: string;
  readonly isFavorite?: boolean;
  readonly isTracked?: boolean;
  readonly priorityMin?: number;
  readonly priorityMax?: number;
}

export interface SemanticSavedViewConfig {
  readonly schemaVersion: 1;
  readonly filters: SemanticSavedViewFilters;
  readonly sort: SemanticKeywordSort;
  readonly columns: readonly SemanticSavedViewColumnKey[];
  readonly density: SemanticSavedViewDensity;
}

export interface SemanticSavedView {
  readonly id: string;
  readonly ownerId: string;
  readonly scope: SemanticSavedViewScope;
  readonly name: string;
  readonly config: SemanticSavedViewConfig;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateSemanticSavedViewInput {
  readonly name: string;
  readonly scope: SemanticSavedViewScope;
  readonly config: SemanticSavedViewConfig;
}

export interface UpdateSemanticSavedViewInput {
  readonly name?: string;
  readonly config?: SemanticSavedViewConfig;
}

export interface InternalCreateSemanticSavedViewInput
  extends CreateSemanticSavedViewInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export interface InternalUpdateSemanticSavedViewInput
  extends UpdateSemanticSavedViewInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}

export interface InternalDeleteSemanticSavedViewInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
}
