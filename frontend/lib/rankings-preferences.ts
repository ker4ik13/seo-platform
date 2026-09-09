export const rankingsQueryColumnMinWidth = 210;
export const rankingsQueryColumnMaxWidth = 520;
export const rankingsQueryColumnDefaultWidth = 300;

export interface RankingsPreferences {
  readonly dimensionKey: string;
  readonly groupId: string;
  readonly dateFrom: string;
  readonly dateThrough: string;
  readonly sort: "QUERY_ASC" | "POSITION_ASC" | "POSITION_DESC" | "CHANGE_ASC" | "CHANGE_DESC";
  readonly queryColumnWidth: number;
  readonly hiddenDates: readonly string[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SORTS = new Set<RankingsPreferences["sort"]>([
  "QUERY_ASC", "POSITION_ASC", "POSITION_DESC", "CHANGE_ASC", "CHANGE_DESC"
]);

export function readRankingsPreferences(
  projectId: string,
  currentUserId: string,
  fallback: RankingsPreferences,
  storage: StorageLike
): RankingsPreferences {
  try {
    const value = JSON.parse(storage.getItem(storageKey(projectId, currentUserId)) ?? "null") as Record<string, unknown> | null;
    if (!value) return fallback;
    const dateFrom = calendarDate(value.dateFrom) ?? fallback.dateFrom;
    const dateThrough = calendarDate(value.dateThrough) ?? fallback.dateThrough;
    const validRange = dateFrom <= dateThrough;
    return {
      dimensionKey: boundedString(value.dimensionKey, 1_000) ?? fallback.dimensionKey,
      groupId: boundedString(value.groupId, 100) ?? fallback.groupId,
      dateFrom: validRange ? dateFrom : fallback.dateFrom,
      dateThrough: validRange ? dateThrough : fallback.dateThrough,
      sort: typeof value.sort === "string" && SORTS.has(value.sort as RankingsPreferences["sort"])
        ? value.sort as RankingsPreferences["sort"]
        : fallback.sort,
      queryColumnWidth: clampQueryColumnWidth(value.queryColumnWidth),
      hiddenDates: Array.isArray(value.hiddenDates)
        ? [...new Set(value.hiddenDates.flatMap((date) => calendarDate(date) ? [date as string] : []))].slice(0, 31)
        : fallback.hiddenDates
    };
  } catch {
    return fallback;
  }
}

export function writeRankingsPreferences(
  projectId: string,
  currentUserId: string,
  value: RankingsPreferences,
  storage: StorageLike
): void {
  try {
    storage.setItem(storageKey(projectId, currentUserId), JSON.stringify({
      ...value,
      queryColumnWidth: clampQueryColumnWidth(value.queryColumnWidth),
      hiddenDates: [...new Set(value.hiddenDates)].slice(0, 31)
    }));
  } catch {
    // The screen remains usable when browser storage is unavailable.
  }
}

export function clampQueryColumnWidth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(rankingsQueryColumnMaxWidth, Math.max(rankingsQueryColumnMinWidth, Math.round(value)))
    : rankingsQueryColumnDefaultWidth;
}

function storageKey(projectId: string, currentUserId: string): string {
  return `seonorita:rankings-view:v1:${currentUserId}:${projectId}`;
}

function calendarDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function boundedString(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" && value.length <= maximum ? value : undefined;
}
