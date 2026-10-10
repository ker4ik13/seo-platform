import { rankWorkbenchPositionSorts, type ProjectSearchCity, type SemanticRankDimension, type RankWorkbenchPositionSort } from "@seo-platform/contracts";


export const rankingsQueryColumnMinWidth = 210;
export const rankingsQueryColumnMaxWidth = 520;
export const rankingsQueryColumnDefaultWidth = 300;
export const rankingsNumberColumnDefaultWidth = 52;
export const rankingsNumberColumnMinWidth = 36;
export const rankingsNumberColumnMaxWidth = 120;

export function clampNumberColumnWidth(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(rankingsNumberColumnMaxWidth, Math.max(rankingsNumberColumnMinWidth, value)))
    : rankingsNumberColumnDefaultWidth;
}

export interface RankingsPreferences {
  readonly mode: "SEO" | "AI";
  readonly seoDimensionKey: string;
  readonly aiDimensionKey: string;
  readonly groupId: string;
  readonly dateFrom: string;
  readonly dateThrough: string;
  readonly sort: RankWorkbenchPositionSort;
  readonly targetUrlState?: "SET" | "EMPTY";
  readonly multipleUrlsState?: "MULTIPLE" | "NOT_MULTIPLE";
  readonly numberColumnWidth?: number;
  readonly queryColumnWidth: number;
  readonly hiddenDates: readonly string[];
  readonly includeUntracked?: boolean;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SORTS = new Set<RankingsPreferences["sort"]>(rankWorkbenchPositionSorts);

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
      mode: value.mode === "AI" || value.mode === "SEO"
        ? value.mode
        : fallback.mode,
      seoDimensionKey:
        boundedString(value.seoDimensionKey, 1_000) ??
        boundedString(value.dimensionKey, 1_000) ??
        fallback.seoDimensionKey,
      aiDimensionKey:
        boundedString(value.aiDimensionKey, 1_000) ??
        fallback.aiDimensionKey,
      groupId: boundedString(value.groupId, 100) ?? fallback.groupId,
      includeUntracked: typeof value.includeUntracked === "boolean" ? value.includeUntracked : fallback.includeUntracked ?? false,
      dateFrom: validRange ? dateFrom : fallback.dateFrom,
      dateThrough: validRange ? dateThrough : fallback.dateThrough,
      sort: typeof value.sort === "string" && SORTS.has(value.sort as RankingsPreferences["sort"])
        ? value.sort as RankingsPreferences["sort"]
        : fallback.sort,
      queryColumnWidth: clampQueryColumnWidth(value.queryColumnWidth),
      hiddenDates: Array.isArray(value.hiddenDates)
        ? [...new Set(value.hiddenDates.flatMap((date) => calendarDate(date) ? [date as string] : []))].slice(0, 31)
        : fallback.hiddenDates,
      ...(value.numberColumnWidth === undefined ? {} : { numberColumnWidth: clampNumberColumnWidth(value.numberColumnWidth) }),
      ...(value.targetUrlState === "SET" || value.targetUrlState === "EMPTY" ? { targetUrlState: value.targetUrlState } : {}),
      ...(value.multipleUrlsState === "MULTIPLE" || value.multipleUrlsState === "NOT_MULTIPLE" ? { multipleUrlsState: value.multipleUrlsState } : {})
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
      ...(value.numberColumnWidth === undefined ? {} : { numberColumnWidth: clampNumberColumnWidth(value.numberColumnWidth) }),
      hiddenDates: [...new Set(value.hiddenDates)].slice(0, 31)
    }));
  } catch {
    // The screen remains usable when browser storage is unavailable.
  }
}

export function readPreferredSeoDimensionKey(
  projectId: string,
  currentUserId: string,
  storage: StorageLike
): string {
  try {
    const value = JSON.parse(storage.getItem(storageKey(projectId, currentUserId)) ?? "null") as Record<string, unknown> | null;
    return boundedString(value?.seoDimensionKey, 1_000) ??
      boundedString(value?.dimensionKey, 1_000) ??
      "";
  } catch {
    return "";
  }
}

export function readIncludeUntracked(projectId: string, userId: string, storage: StorageLike): boolean {
  try { return (JSON.parse(storage.getItem(storageKey(projectId, userId)) ?? "null") as RankingsPreferences | null)?.includeUntracked === true; }
  catch { return false; }
}

export function writeIncludeUntracked(projectId: string, userId: string, value: boolean, storage: StorageLike): void {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(storageKey(projectId, userId)) ?? "null");
    const current = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    storage.setItem(storageKey(projectId, userId), JSON.stringify({ ...current, includeUntracked: value }));
  } catch { /* The screen remains usable without storage. */ }
}

export function writePreferredSeoDimensionKey(
  projectId: string,
  currentUserId: string,
  dimensionKey: string,
  storage: StorageLike
): void {
  if (!dimensionKey || dimensionKey.length > 1_000) return;
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(projectId, currentUserId)) ?? "null") as unknown;
    const current = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    storage.setItem(
      storageKey(projectId, currentUserId),
      JSON.stringify({ ...current, seoDimensionKey: dimensionKey })
    );
  } catch {
    // The exact dashboard selection remains usable in memory.
  }
}

export function preferredProjectRankDimensionKey(
  dimensions: readonly SemanticRankDimension[],
  savedDimensionKey: string,
  projectSearchCity?: ProjectSearchCity
): string {
  if (savedDimensionKey && dimensions.some(({ key }) => key === savedDimensionKey)) {
    return savedDimensionKey;
  }
  if (projectSearchCity) {
    const matching = dimensions.filter((dimension) =>
      dimension.regionCode === (
        dimension.searchEngine === "YANDEX"
          ? projectSearchCity.yandexRegionCode
          : projectSearchCity.googleRegionCode
      )
    );
    const preferred = [...matching].sort((left, right) =>
      Number(right.device === "DESKTOP") - Number(left.device === "DESKTOP") ||
      Number(right.searchEngine === "YANDEX") - Number(left.searchEngine === "YANDEX")
    )[0];
    if (preferred) return preferred.key;
  }
  return dimensions[0]?.key ?? "";
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
