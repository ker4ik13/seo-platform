import type {
  SemanticKeywordPageSize,
  SemanticKeywordIntent,
  SemanticKeywordSort
} from "./keywords.js";

export const semanticSavedViewGroupSidebarWidthMin = 196 as const;
export const semanticSavedViewGroupSidebarWidthMax = 520 as const;

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

export const semanticSavedViewQueryIndicators = [
  "AI_ANSWER",
  "MULTIPLE_URLS",
  "TARGET_URL_MISMATCH"
] as const;

export type SemanticSavedViewQueryIndicator =
  (typeof semanticSavedViewQueryIndicators)[number];

export const semanticSavedViewSchemaVersions = [1, 2, 3] as const;
export const semanticSavedViewCurrentSchemaVersion = 3 as const;
export type SemanticSavedViewSchemaVersion =
  (typeof semanticSavedViewSchemaVersions)[number];

export const semanticSystemColumnKeys = [
  "query",
  "frequency",
  "frequencyExact",
  "frequencyFixed",
  "wordCount",
  "yandexPosition",
  "yandexRelevantUrl",
  "googlePosition",
  "googleRelevantUrl",
  "yandexAiPosition",
  "yandexAiRelevantUrl",
  "googleAiPosition",
  "googleAiRelevantUrl",
  "yandexCheckedAt",
  "googleCheckedAt",
  "yandexAiCheckedAt",
  "googleAiCheckedAt",
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
  readonly schemaVersion: SemanticSavedViewSchemaVersion;
  readonly filters: SemanticSavedViewFilters;
  readonly sort: SemanticKeywordSort;
  /** Visible columns in their table order. */
  readonly columns: readonly SemanticSavedViewColumnKey[];
  /** Full drawer order, including columns currently hidden by the user. */
  readonly columnOrder?: readonly SemanticSavedViewColumnKey[];
  readonly density: SemanticSavedViewDensity;
  /** Enabled compact actions and warnings rendered beside the query text. */
  readonly queryIndicators?: readonly SemanticSavedViewQueryIndicator[];
  /** Widths are keyed only by columns present in this saved view. */
  readonly columnWidths?: Readonly<Partial<Record<SemanticSavedViewColumnKey, number>>>;
  /** Number of rows loaded by each infinite-scroll request. */
  readonly pageSize?: SemanticKeywordPageSize;
  /** Width of the folder tree in CSS pixels. */
  readonly groupSidebarWidth?: number;
  /** Expanded folders in the semantic tree. */
  readonly expandedGroupIds?: readonly string[];
  /** A multi-folder selection; an empty array means the project root. */
  readonly selectedGroupIds?: readonly string[];
  /**
   * Personal pointer to the visible view applied by the current user.
   * Stored only in the internal per-user project layout view.
   */
  readonly appliedViewId?: string;
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
  readonly canManageShared: boolean;
}

export interface InternalUpdateSemanticSavedViewInput
  extends UpdateSemanticSavedViewInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
  readonly canManageShared: boolean;
}

export interface InternalDeleteSemanticSavedViewInput {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly version: number;
  readonly canManageShared: boolean;
}
