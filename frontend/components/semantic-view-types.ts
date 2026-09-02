import {
  semanticSavedViewCurrentSchemaVersion,
  semanticSavedViewQueryIndicators,
  semanticSystemColumnKeys
} from "@seo-platform/contracts";

export type SemanticKeywordIntent =
  | "INFORMATIONAL"
  | "NAVIGATIONAL"
  | "COMMERCIAL"
  | "TRANSACTIONAL"
  | "LOCAL"
  | "MIXED";

export type SemanticKeywordSort =
  import("@seo-platform/contracts").SemanticKeywordSort;

export type SemanticQueryIndicator =
  import("@seo-platform/contracts").SemanticSavedViewQueryIndicator;

export type SemanticSystemColumn =
  | "query"
  | "frequency"
  | "frequencyExact"
  | "frequencyFixed"
  | "wordCount"
  | "yandexPosition"
  | "yandexRelevantUrl"
  | "googlePosition"
  | "googleRelevantUrl"
  | "yandexAiPosition"
  | "yandexAiRelevantUrl"
  | "googleAiPosition"
  | "googleAiRelevantUrl"
  | "yandexCheckedAt"
  | "googleCheckedAt"
  | "yandexAiCheckedAt"
  | "googleAiCheckedAt"
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
  readonly tag?: string;
  readonly intent?: SemanticKeywordIntent;
  readonly groupId?: string;
  readonly clusterId?: string;
  readonly isFavorite?: boolean;
  readonly isTracked?: boolean;
  readonly priorityMin?: number;
  readonly priorityMax?: number;
}

export interface SemanticViewConfig {
  readonly schemaVersion: import("@seo-platform/contracts").SemanticSavedViewSchemaVersion;
  readonly filters: SemanticViewFilters;
  readonly sort: SemanticKeywordSort;
  readonly columns: readonly SemanticViewColumn[];
  readonly columnOrder?: readonly SemanticViewColumn[];
  readonly density: "COMFORTABLE" | "COMPACT";
  readonly queryIndicators?: readonly SemanticQueryIndicator[];
  readonly columnWidths?: Readonly<Record<string, number>>;
  readonly pageSize?: 100 | 200 | 500 | 1_000;
  readonly groupSidebarWidth?: number;
  readonly expandedGroupIds?: readonly string[];
  readonly selectedGroupIds?: readonly string[];
  readonly appliedViewId?: string;
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
        scope === "PRIVATE" &&
        name === semanticFolderSortViewName(groupId)
    )?.config.sort ?? fallback
  );
}

export const defaultSemanticViewConfig: SemanticViewConfig = {
  schemaVersion: semanticSavedViewCurrentSchemaVersion,
  filters: {},
  sort: "CREATED_DESC",
  columns: [
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
    "group",
    "cluster",
    "targetUrl",
    "tags",
    "intent",
    "source",
    "updatedAt"
  ],
  columnOrder: semanticSystemColumnKeys,
  density: "COMFORTABLE",
  queryIndicators: semanticSavedViewQueryIndicators
};

export function semanticViewConfigForCurrentSchema(
  config: SemanticViewConfig
): SemanticViewConfig {
  if (config.schemaVersion === semanticSavedViewCurrentSchemaVersion) {
    return config;
  }
  const columns = withAiAnswerRankingUrls(
    config.schemaVersion === 1
      ? withCapturedRankingUrls(config.columns)
      : config.columns
  );
  const columnOrder = config.columnOrder === undefined
    ? undefined
    : withAiAnswerRankingUrls(
        config.schemaVersion === 1
          ? withCapturedRankingUrls(config.columnOrder)
          : config.columnOrder
      );
  return {
    ...config,
    schemaVersion: semanticSavedViewCurrentSchemaVersion,
    columns,
    ...(columnOrder === undefined ? {} : { columnOrder })
  };
}

function withCapturedRankingUrls(
  columns: readonly SemanticViewColumn[]
): readonly SemanticViewColumn[] {
  const pairs = [
    ["yandexPosition", "yandexRelevantUrl"],
    ["googlePosition", "googleRelevantUrl"]
  ] as const satisfies readonly (readonly [
    SemanticViewColumn,
    SemanticViewColumn
  ])[];
  return pairs.reduce<readonly SemanticViewColumn[]>((current, pair) => {
    const [positionColumn, urlColumn] = pair;
    if (current.includes(urlColumn)) return current;
    const position = current.indexOf(positionColumn);
    const insertAt = position < 0 ? current.length : position + 1;
    return [
      ...current.slice(0, insertAt),
      urlColumn,
      ...current.slice(insertAt)
    ];
  }, columns);
}

function withAiAnswerRankingUrls(
  columns: readonly SemanticViewColumn[]
): readonly SemanticViewColumn[] {
  const pairs = [
    ["yandexAiPosition", "yandexAiRelevantUrl"],
    ["googleAiPosition", "googleAiRelevantUrl"]
  ] as const satisfies readonly (readonly [
    SemanticViewColumn,
    SemanticViewColumn
  ])[];
  return pairs.reduce<readonly SemanticViewColumn[]>((current, pair) => {
    const [positionColumn, urlColumn] = pair;
    if (current.includes(urlColumn)) return current;
    const position = current.indexOf(positionColumn);
    const insertAt = position < 0 ? current.length : position + 1;
    return [
      ...current.slice(0, insertAt),
      urlColumn,
      ...current.slice(insertAt)
    ];
  }, columns);
}

export function semanticQueryIndicatorsFor(
  config: Pick<SemanticViewConfig, "queryIndicators">
): readonly SemanticQueryIndicator[] {
  const enabled = new Set(
    config.queryIndicators ?? semanticSavedViewQueryIndicators
  );
  return semanticSavedViewQueryIndicators.filter((indicator) =>
    enabled.has(indicator)
  );
}

export function semanticColumnOrderFor(
  config: Pick<SemanticViewConfig, "columns" | "columnOrder">,
  availableColumns: readonly SemanticViewColumn[]
): readonly SemanticViewColumn[] {
  const available = new Set(availableColumns);
  const seen = new Set<SemanticViewColumn>();
  const ordered: SemanticViewColumn[] = [];
  const append = (column: SemanticViewColumn): void => {
    if (!available.has(column) || seen.has(column)) return;
    seen.add(column);
    ordered.push(column);
  };

  for (const column of config.columnOrder ?? config.columns) append(column);
  for (const column of config.columns) append(column);
  for (const column of availableColumns) append(column);
  return ordered;
}
