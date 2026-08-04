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
  | "UPDATED_ASC"
  | "TEXT_ASC"
  | "TEXT_DESC"
  | "PRIORITY_DESC"
  | "PRIORITY_ASC"
  | "SOURCE_ASC"
  | "SOURCE_DESC"
  | "FREQUENCY_BASE_DESC"
  | "FREQUENCY_BASE_ASC"
  | "FREQUENCY_EXACT_DESC"
  | "FREQUENCY_EXACT_ASC"
  | "FREQUENCY_FIXED_DESC"
  | "FREQUENCY_FIXED_ASC"
  | "YANDEX_POSITION_ASC"
  | "YANDEX_POSITION_DESC"
  | "GOOGLE_POSITION_ASC"
  | "GOOGLE_POSITION_DESC"
  | "YANDEX_CHECKED_AT_ASC"
  | "YANDEX_CHECKED_AT_DESC"
  | "GOOGLE_CHECKED_AT_ASC"
  | "GOOGLE_CHECKED_AT_DESC";

export type SemanticSystemColumn =
  | "query"
  | "frequency"
  | "frequencyExact"
  | "frequencyFixed"
  | "wordCount"
  | "yandexPosition"
  | "googlePosition"
  | "yandexRelevantUrl"
  | "googleRelevantUrl"
  | "yandexCheckedAt"
  | "googleCheckedAt"
  | "visibility"
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

export const semanticProjectTableViewName = "__project_table_layout__";
export const positionsProjectTableViewName = "__positions_project_table_layout__";
export const semanticFolderSortViewPrefix = "__folder_sort__:";

export function semanticFolderSortViewName(groupId?: string): string {
  return `${semanticFolderSortViewPrefix}${groupId ?? "root"}`;
}

export function isInternalSemanticViewName(name: string): boolean {
  return (
    name === semanticProjectTableViewName ||
    name === positionsProjectTableViewName ||
    name.startsWith(semanticFolderSortViewPrefix)
  );
}

export function semanticFolderSortFor(
  groupId: string | undefined,
  views: readonly SemanticSavedView[],
  fallback: SemanticKeywordSort = defaultSemanticViewConfig.sort
): SemanticKeywordSort {
  return (
    views.find(
      ({ name, scope }) =>
        scope === "PROJECT_SHARED" &&
        name === semanticFolderSortViewName(groupId)
    )?.config.sort ?? fallback
  );
}

export const defaultSemanticViewConfig: SemanticViewConfig = {
  schemaVersion: 1,
  filters: {},
  sort: "CREATED_DESC",
  columns: [
    "query",
    "frequency",
    "frequencyExact",
    "frequencyFixed",
    "wordCount",
    "yandexPosition",
    "googlePosition",
    "yandexCheckedAt",
    "googleCheckedAt",
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

export const defaultPositionsViewConfig: SemanticViewConfig = {
  schemaVersion: 1,
  filters: {},
  sort: "YANDEX_POSITION_ASC",
  columns: [
    "query",
    "group",
    "frequency",
    "yandexPosition",
    "yandexRelevantUrl",
    "googlePosition",
    "googleRelevantUrl",
    "yandexCheckedAt",
    "googleCheckedAt",
    "visibility",
    "targetUrl",
    "updatedAt"
  ],
  density: "COMFORTABLE"
};
