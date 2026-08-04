import {
  semanticKeywordDefaultPageSize,
  semanticKeywordPageSizes,
  type SemanticKeywordPageSize
} from "@seo-platform/contracts";

export const semanticGroupSidebarMinWidth = 196;
export const semanticGroupSidebarMaxWidth = 520;
export const semanticGroupSidebarDefaultWidth = 230;

export const semanticColumnMinWidth = 64;
export const semanticColumnMaxWidth = 640;

export interface SemanticLayoutPreferences {
  readonly groupSidebarWidth: number;
  readonly columnWidths: Readonly<Record<string, number>>;
  readonly pageSize: SemanticKeywordPageSize;
  readonly expandedGroupIds: readonly string[] | null;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const semanticLayoutStoragePrefix = "seonorita:semantic-layout:v1:";

const defaultColumnWidths: Readonly<Record<string, number>> = {
  query: 260,
  frequency: 92,
  frequencyExact: 86,
  frequencyFixed: 86,
  wordCount: 72,
  yandexPosition: 112,
  googlePosition: 112,
  yandexRelevantUrl: 220,
  googleRelevantUrl: 220,
  yandexCheckedAt: 136,
  googleCheckedAt: 136,
  visibility: 104,
  group: 170,
  cluster: 132,
  targetUrl: 210,
  tags: 142,
  intent: 126,
  priority: 82,
  source: 108,
  updatedAt: 116
};

export function semanticColumnDefaultWidth(column: string): number {
  return defaultColumnWidths[column] ?? (column.startsWith("custom:") ? 168 : 132);
}

export function clampSemanticGroupSidebarWidth(width: number): number {
  return clampRounded(
    width,
    semanticGroupSidebarMinWidth,
    semanticGroupSidebarMaxWidth,
    semanticGroupSidebarDefaultWidth
  );
}

export function clampSemanticColumnWidth(
  column: string,
  width: number
): number {
  const minWidth = column === "query" ? 180 : semanticColumnMinWidth;
  return clampRounded(
    width,
    minWidth,
    semanticColumnMaxWidth,
    semanticColumnDefaultWidth(column)
  );
}

export function readSemanticLayoutPreferences(
  projectId: string,
  storage: StorageLike
): SemanticLayoutPreferences {
  const fallback: SemanticLayoutPreferences = {
    groupSidebarWidth: semanticGroupSidebarDefaultWidth,
    columnWidths: {},
    pageSize: semanticKeywordDefaultPageSize,
    expandedGroupIds: null
  };
  try {
    const raw = storage.getItem(semanticLayoutStorageKey(projectId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as {
      groupSidebarWidth?: unknown;
      columnWidths?: unknown;
      pageSize?: unknown;
      expandedGroupIds?: unknown;
    };
    const groupSidebarWidth =
      typeof parsed.groupSidebarWidth === "number"
        ? clampSemanticGroupSidebarWidth(parsed.groupSidebarWidth)
        : semanticGroupSidebarDefaultWidth;
    const columnWidths: Record<string, number> = {};
    if (isRecord(parsed.columnWidths)) {
      for (const [column, width] of Object.entries(parsed.columnWidths)) {
        if (typeof width === "number" && Number.isFinite(width)) {
          columnWidths[column] = clampSemanticColumnWidth(column, width);
        }
      }
    }
    return {
      groupSidebarWidth,
      columnWidths,
      pageSize: normalizeSemanticKeywordPageSize(parsed.pageSize),
      expandedGroupIds: normalizeExpandedGroupIds(parsed.expandedGroupIds)
    };
  } catch {
    return fallback;
  }
}

export function writeSemanticLayoutPreferences(
  projectId: string,
  preferences: SemanticLayoutPreferences,
  storage: StorageLike
): void {
  try {
    storage.setItem(
      semanticLayoutStorageKey(projectId),
      JSON.stringify({
        groupSidebarWidth: clampSemanticGroupSidebarWidth(
          preferences.groupSidebarWidth
        ),
        columnWidths: Object.fromEntries(
          Object.entries(preferences.columnWidths).map(([column, width]) => [
            column,
            clampSemanticColumnWidth(column, width)
          ])
        ),
        pageSize: normalizeSemanticKeywordPageSize(preferences.pageSize),
        expandedGroupIds: preferences.expandedGroupIds
          ? [...new Set(preferences.expandedGroupIds.filter(isNonEmptyString))]
          : null
      })
    );
  } catch {
    // Layout preferences are progressive enhancement; storage may be disabled.
  }
}

export function normalizeSemanticKeywordPageSize(
  value: unknown
): SemanticKeywordPageSize {
  return typeof value === "number" &&
    semanticKeywordPageSizes.some((pageSize) => pageSize === value)
    ? (value as SemanticKeywordPageSize)
    : semanticKeywordDefaultPageSize;
}

function semanticLayoutStorageKey(projectId: string): string {
  return `${semanticLayoutStoragePrefix}${projectId}`;
}

function clampRounded(
  value: number,
  min: number,
  max: number,
  fallback: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeExpandedGroupIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter(isNonEmptyString))];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
