export type SemanticKeywordIntent =
  | "INFORMATIONAL"
  | "NAVIGATIONAL"
  | "COMMERCIAL"
  | "TRANSACTIONAL"
  | "LOCAL"
  | "MIXED";

export type SemanticKeywordSort =
  | "CREATED_DESC"
  | "CREATED_ASC"
  | "UPDATED_DESC"
  | "TEXT_ASC"
  | "PRIORITY_DESC";

export type SemanticSystemColumn =
  | "query"
  | "group"
  | "cluster"
  | "targetUrl"
  | "tags"
  | "intent"
  | "priority"
  | "source"
  | "updatedAt";

export type SemanticViewColumn =
  | SemanticSystemColumn
  | `custom:${string}`;

export interface SemanticViewFilters {
  readonly search?: string;
  readonly intent?: SemanticKeywordIntent;
  readonly groupId?: string;
  readonly clusterId?: string;
  readonly isFavorite?: boolean;
  readonly isTracked?: boolean;
  readonly priorityMin?: number;
  readonly priorityMax?: number;
}

export interface SemanticViewConfig {
  readonly schemaVersion: 1;
  readonly filters: SemanticViewFilters;
  readonly sort: SemanticKeywordSort;
  readonly columns: readonly SemanticViewColumn[];
  readonly density: "COMFORTABLE" | "COMPACT";
}

export interface SemanticSavedView {
  readonly id: string;
  readonly ownerId: string;
  readonly scope: "PRIVATE" | "PROJECT_SHARED";
  readonly name: string;
  readonly config: SemanticViewConfig;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const defaultSemanticViewConfig: SemanticViewConfig = {
  schemaVersion: 1,
  filters: {},
  sort: "CREATED_DESC",
  columns: [
    "query",
    "group",
    "cluster",
    "targetUrl",
    "tags",
    "intent",
    "source",
    "updatedAt"
  ],
  density: "COMFORTABLE"
};
