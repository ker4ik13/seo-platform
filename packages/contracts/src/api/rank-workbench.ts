import {
  parseSemanticRankDimensionKey,
  type SemanticRankDimension
} from "./rank-dimensions.js";

export const rankWorkbenchPageSizes = [50, 100, 200] as const;
export type RankWorkbenchPageSize = (typeof rankWorkbenchPageSizes)[number];

export const rankWorkbenchPositionSorts = [
  "OBSERVED_DESC",
  "QUERY_ASC",
  "POSITION_ASC",
  "POSITION_DESC",
  "CHANGE_ASC",
  "CHANGE_DESC"
] as const;
export type RankWorkbenchPositionSort =
  (typeof rankWorkbenchPositionSorts)[number];

export const rankWorkbenchMaxDimensions = 5 as const;
export const rankWorkbenchMaxDates = 31 as const;

export interface RankWorkbenchKeywordScope {
  readonly groupIds?: readonly string[];
  readonly search?: string;
  readonly limit: RankWorkbenchPageSize;
  readonly cursor?: string;
}

export interface RankPositionReportInput extends RankWorkbenchKeywordScope {
  readonly includeUntracked?: boolean;
  readonly mode: "SEO" | "AI";
  readonly dimensionKey: string;
  readonly observedFrom: string;
  readonly observedBefore: string;
  readonly dateLimit: number;
  readonly sort: RankWorkbenchPositionSort;
}

export interface RankPositionReportCell {
  readonly date: string;
  readonly snapshotId: string;
  readonly observedAt: string;
  readonly found: boolean;
  readonly position?: number;
  readonly previousPosition?: number;
  readonly rankingUrl?: string;
  readonly siteResultCount: number;
  readonly aiAnswer?: Readonly<{
    snapshotId: string;
    observedAt: string;
    answerPresent: boolean;
    siteFound: boolean;
    position?: number;
    previousPosition?: number;
    rankingUrl?: string;
    brandFound: boolean;
  }>;
}

export interface RankPositionReportRow {
  readonly isTracked?: boolean;
  readonly keywordId: string;
  readonly version: number;
  readonly query: string;
  readonly language: string;
  readonly createdAt: string;
  readonly groupPath?: string;
  readonly targetUrl?: string;
  readonly frequencies: readonly Readonly<{
    type: "BASE" | "EXACT" | "FIXED";
    value: string;
  }>[];
  readonly cells: readonly RankPositionReportCell[];
}

export interface RankPositionReportTrendPoint {
  readonly date: string;
  readonly measured: number;
  readonly found: number;
  readonly top3: number;
  readonly top10: number;
  readonly top30: number;
  readonly averagePosition?: number;
}

export interface RankPositionReportSummary {
  readonly keywordCount: number;
  readonly measuredCount: number;
  readonly foundCount: number;
  readonly notFoundCount: number;
  readonly improvedCount: number;
  readonly declinedCount: number;
  readonly unchangedCount: number;
  readonly newCount: number;
  readonly lostCount: number;
  readonly top1Count: number;
  readonly top3Count: number;
  readonly top5Count: number;
  readonly top10Count: number;
  readonly top30Count: number;
  readonly top50Count: number;
  readonly top100Count: number;
  readonly averagePosition?: number;
  readonly medianPosition?: number;
}

export interface RankPositionReport {
  readonly dimension: SemanticRankDimension;
  readonly dates: readonly string[];
  readonly summary: RankPositionReportSummary;
  readonly trend: readonly RankPositionReportTrendPoint[];
  readonly rows: readonly RankPositionReportRow[];
  readonly page: {
    readonly hasNext: boolean;
    readonly nextCursor?: string;
    readonly totalApprox?: number;
  };
}

export interface SerpWorkbenchInput extends RankWorkbenchKeywordScope {
  readonly dimensionKeys: readonly string[];
}

export interface SerpWorkbenchResult {
  readonly position: number;
  readonly url: string;
  readonly faviconUrl?: string;
  readonly title?: string;
  readonly snippet?: string;
}

export const serpWorkbenchSnapshotProviders = [
  "ARSENKIN",
  "XMLSTOCK",
  "KEY_COLLECTOR"
] as const;

export type SerpWorkbenchSnapshotProvider =
  (typeof serpWorkbenchSnapshotProviders)[number];

export interface SerpWorkbenchSnapshot {
  readonly dimensionKey: string;
  readonly snapshotId: string;
  readonly observedAt: string;
  readonly provider: SerpWorkbenchSnapshotProvider;
  readonly results: readonly SerpWorkbenchResult[];
}

export interface SerpWorkbenchAiSnapshot {
  readonly dimensionKey: string;
  readonly snapshotId: string;
  readonly observedAt: string;
  readonly provider: "ARSENKIN";
  readonly results: readonly SerpWorkbenchResult[];
}

export interface SerpWorkbenchRow {
  readonly keywordId: string;
  readonly version: number;
  readonly query: string;
  readonly language: string;
  readonly groupPath?: string;
  readonly tags: readonly string[];
  readonly targetUrl?: string;
  readonly snapshots: readonly SerpWorkbenchSnapshot[];
  readonly aiSnapshots: readonly SerpWorkbenchAiSnapshot[];
}

export interface SerpWorkbenchReport {
  readonly dimensions: readonly SemanticRankDimension[];
  readonly rows: readonly SerpWorkbenchRow[];
  readonly page: {
    readonly hasNext: boolean;
    readonly nextCursor?: string;
    readonly totalApprox?: number;
  };
}

export interface DeleteRankDimensionHistoryInput {
  readonly dimensionKey: string;
  readonly confirmation: "DELETE";
}

export interface RankDimensionHistoryDeletion {
  readonly id: string;
  readonly dimension: SemanticRankDimension;
  readonly excludedThrough: string;
  readonly affectedSnapshots: number;
  readonly createdAt: string;
}

export interface CreateRankDimensionMergeInput {
  readonly sourceDimensionKey: string;
  readonly targetDimensionKey: string;
}

export interface RankDimensionMergeSummary {
  readonly id: string;
  readonly source: SemanticRankDimension;
  readonly target: SemanticRankDimension;
  readonly version: number;
  readonly createdAt: string;
}

export interface RankDimensionMergeSettings {
  readonly dimensions: readonly SemanticRankDimension[];
  readonly merges: readonly RankDimensionMergeSummary[];
}

export function parseRankPositionReportInput(
  value: unknown
): RankPositionReportInput {
  const input = exactRecord(value, [
    "dimensionKey",
    "observedFrom",
    "observedBefore",
    "dateLimit",
    "groupIds",
    "search",
    "limit",
    "cursor",
    "sort",
    "mode",
    "includeUntracked"
  ]);
  const dimensionKey = rankDimensionKey(input.dimensionKey);
  const observedFrom = instant(input.observedFrom);
  const observedBefore = instant(input.observedBefore);
  const range = Date.parse(observedBefore) - Date.parse(observedFrom);
  if (range <= 0 || range > 3 * 366 * 86_400_000) invalid();
  const dateLimit = integer(input.dateLimit, 2, rankWorkbenchMaxDates);
  const sort = member(input.sort, rankWorkbenchPositionSorts);
  const mode = input.mode === undefined
    ? "SEO"
    : member(input.mode, ["SEO", "AI"] as const);
  if (input.includeUntracked !== undefined && typeof input.includeUntracked !== "boolean") invalid();
  return {
    ...keywordScope(input),
    mode,
    ...(input.includeUntracked === undefined ? {} : { includeUntracked: input.includeUntracked as boolean }),
    dimensionKey,
    observedFrom,
    observedBefore,
    dateLimit,
    sort
  };
}

export function parseSerpWorkbenchInput(value: unknown): SerpWorkbenchInput {
  const input = exactRecord(value, [
    "dimensionKeys",
    "groupIds",
    "search",
    "limit",
    "cursor"
  ]);
  if (
    !Array.isArray(input.dimensionKeys) ||
    input.dimensionKeys.length < 1 ||
    input.dimensionKeys.length > rankWorkbenchMaxDimensions
  ) invalid();
  const dimensionKeys = input.dimensionKeys.map(rankDimensionKey);
  if (new Set(dimensionKeys).size !== dimensionKeys.length) invalid();
  return { ...keywordScope(input), dimensionKeys };
}

export function parseDeleteRankDimensionHistoryInput(
  value: unknown
): DeleteRankDimensionHistoryInput {
  const input = exactRecord(value, ["dimensionKey", "confirmation"]);
  if (input.confirmation !== "DELETE") invalid();
  return {
    dimensionKey: rankDimensionKey(input.dimensionKey),
    confirmation: "DELETE"
  };
}

export function parseCreateRankDimensionMergeInput(
  value: unknown
): CreateRankDimensionMergeInput {
  const input = exactRecord(value, ["sourceDimensionKey", "targetDimensionKey"]);
  const sourceDimensionKey = rankDimensionKey(input.sourceDimensionKey);
  const targetDimensionKey = rankDimensionKey(input.targetDimensionKey);
  if (sourceDimensionKey === targetDimensionKey) invalid();
  return { sourceDimensionKey, targetDimensionKey };
}

export function parseRankDimensionMergeSettings(
  value: unknown
): RankDimensionMergeSettings {
  const input = exactRecord(value, ["dimensions", "merges"]);
  if (
    !Array.isArray(input.dimensions) ||
    input.dimensions.length > 2_000 ||
    !Array.isArray(input.merges) ||
    input.merges.length > 2_000
  ) invalid();
  const dimensions = input.dimensions.map(rankDimension);
  const dimensionKeys = new Set(dimensions.map(({ key }) => key));
  if (dimensionKeys.size !== dimensions.length) invalid();
  const mergeIds = new Set<string>();
  const sourceKeys = new Set<string>();
  const merges = input.merges.map((value) => {
    const row = exactRecord(value, ["id", "source", "target", "version", "createdAt"]);
    const id = uuid(row.id);
    const source = rankDimension(row.source);
    const target = rankDimension(row.target);
    if (
      mergeIds.has(id) ||
      sourceKeys.has(source.key) ||
      source.key === target.key
    ) invalid();
    mergeIds.add(id);
    sourceKeys.add(source.key);
    return {
      id,
      source,
      target,
      version: integer(row.version, 1, 2_147_483_647),
      createdAt: instant(row.createdAt)
    };
  });
  return { dimensions, merges };
}

/** Rebuilds the internal SEO-data response through a bounded allowlist. */
export function parseRankPositionReport(value: unknown): RankPositionReport {
  const input = exactRecord(value, ["dimension", "dates", "summary", "trend", "rows", "page"]);
  const dimension = rankDimension(input.dimension);
  const dates = calendarDateList(input.dates, rankWorkbenchMaxDates);
  const dateSet = new Set(dates);
  const summaryValue = exactRecord(input.summary, [
    "keywordCount", "measuredCount", "foundCount", "notFoundCount",
    "improvedCount", "declinedCount", "unchangedCount", "newCount",
    "lostCount", "top1Count", "top3Count", "top5Count", "top10Count",
    "top30Count", "top50Count", "top100Count",
    "averagePosition", "medianPosition"
  ]);
  const summary: RankPositionReportSummary = {
    keywordCount: integer(summaryValue.keywordCount, 0, Number.MAX_SAFE_INTEGER),
    measuredCount: integer(summaryValue.measuredCount, 0, Number.MAX_SAFE_INTEGER),
    foundCount: integer(summaryValue.foundCount, 0, Number.MAX_SAFE_INTEGER),
    notFoundCount: integer(summaryValue.notFoundCount, 0, Number.MAX_SAFE_INTEGER),
    improvedCount: integer(summaryValue.improvedCount, 0, Number.MAX_SAFE_INTEGER),
    declinedCount: integer(summaryValue.declinedCount, 0, Number.MAX_SAFE_INTEGER),
    unchangedCount: integer(summaryValue.unchangedCount, 0, Number.MAX_SAFE_INTEGER),
    newCount: integer(summaryValue.newCount, 0, Number.MAX_SAFE_INTEGER),
    lostCount: integer(summaryValue.lostCount, 0, Number.MAX_SAFE_INTEGER),
    top1Count: integer(summaryValue.top1Count, 0, Number.MAX_SAFE_INTEGER),
    top3Count: integer(summaryValue.top3Count, 0, Number.MAX_SAFE_INTEGER),
    top5Count: integer(summaryValue.top5Count, 0, Number.MAX_SAFE_INTEGER),
    top10Count: integer(summaryValue.top10Count, 0, Number.MAX_SAFE_INTEGER),
    top30Count: integer(summaryValue.top30Count, 0, Number.MAX_SAFE_INTEGER),
    top50Count: integer(summaryValue.top50Count, 0, Number.MAX_SAFE_INTEGER),
    top100Count: integer(summaryValue.top100Count, 0, Number.MAX_SAFE_INTEGER),
    ...(summaryValue.averagePosition === undefined
      ? {}
      : { averagePosition: finiteNumber(summaryValue.averagePosition, 1, 100_000) }),
    ...(summaryValue.medianPosition === undefined
      ? {}
      : { medianPosition: finiteNumber(summaryValue.medianPosition, 1, 100_000) })
  };
  if ([summary.top1Count, summary.top3Count, summary.top5Count, summary.top10Count,
    summary.top30Count, summary.top50Count, summary.top100Count, summary.foundCount]
    .some((count, index, values) => index > 0 && count < values[index - 1]!)) invalid();
  if (!Array.isArray(input.trend) || input.trend.length > rankWorkbenchMaxDates) invalid();
  const trend = input.trend.map((value) => {
    const point = exactRecord(value, ["date", "measured", "found", "top3", "top10", "top30", "averagePosition"]);
    const date = calendarDate(point.date);
    if (!dateSet.has(date)) invalid();
    return {
      date,
      measured: integer(point.measured, 0, Number.MAX_SAFE_INTEGER),
      found: integer(point.found, 0, Number.MAX_SAFE_INTEGER),
      top3: integer(point.top3, 0, Number.MAX_SAFE_INTEGER),
      top10: integer(point.top10, 0, Number.MAX_SAFE_INTEGER),
      top30: integer(point.top30, 0, Number.MAX_SAFE_INTEGER),
      ...(point.averagePosition === undefined
        ? {}
        : { averagePosition: finiteNumber(point.averagePosition, 1, 100_000) })
    };
  });
  if (!Array.isArray(input.rows) || input.rows.length > 200) invalid();
  const keywordIds = new Set<string>();
  const rows = input.rows.map((value) => {
    const row = exactRecord(value, [
      "keywordId", "version", "query", "language", "createdAt", "groupPath",
      "targetUrl", "frequencies", "cells", "isTracked"
    ]);
    const keywordId = uuid(row.keywordId);
    if (keywordIds.has(keywordId) || !Array.isArray(row.cells) || row.cells.length > dates.length) invalid();
    keywordIds.add(keywordId);
    const cellDates = new Set<string>();
    if (row.isTracked !== undefined && typeof row.isTracked !== "boolean") invalid();
    const cells = row.cells.map((value) => {
      const cell = exactRecord(value, [
        "date", "snapshotId", "observedAt", "found", "position",
        "previousPosition", "rankingUrl", "siteResultCount", "aiAnswer"
      ]);
      const date = calendarDate(cell.date);
      if (!dateSet.has(date) || cellDates.has(date) || typeof cell.found !== "boolean") invalid();
      cellDates.add(date);
      const position = cell.position === undefined ? undefined : integer(cell.position, 1, 100_000);
      if (cell.found !== (position !== undefined)) invalid();
      const aiAnswer = cell.aiAnswer === undefined
        ? undefined
        : rankReportAiAnswer(cell.aiAnswer);
      const rankingUrl = cell.rankingUrl === undefined || cell.rankingUrl === null
        ? undefined
        : httpUrl(cell.rankingUrl);
      return {
        date,
        snapshotId: uuid(cell.snapshotId),
        observedAt: instant(cell.observedAt),
        found: cell.found,
        ...(position === undefined ? {} : { position }),
        ...(cell.previousPosition === undefined
          ? {}
          : { previousPosition: integer(cell.previousPosition, 1, 100_000) }),
        ...(rankingUrl === undefined ? {} : { rankingUrl }),
        siteResultCount: integer(cell.siteResultCount, 0, 100),
        ...(aiAnswer ? { aiAnswer } : {})
      };
    });
    if (!Array.isArray(row.frequencies) || row.frequencies.length > 3) invalid();
    const frequencyTypes = new Set<string>();
    const frequencies = row.frequencies.map((value) => {
      const frequency = exactRecord(value, ["type", "value"]);
      if (frequency.type !== "BASE" && frequency.type !== "EXACT" && frequency.type !== "FIXED") invalid();
      const type = frequency.type as RankPositionReportRow["frequencies"][number]["type"];
      if (frequencyTypes.has(type)) invalid();
      frequencyTypes.add(type);
      return {
        type,
        value: unsignedDecimal(frequency.value)
      };
    });
    return {
      keywordId,
      version: integer(row.version, 1, 2_147_483_647),
      query: boundedText(row.query, 20_000),
      language: locale(row.language),
      createdAt: instant(row.createdAt),
      ...(row.groupPath === undefined || row.groupPath === null
        ? {}
        : { groupPath: boundedText(row.groupPath, 4_096) }),
      ...(row.isTracked === undefined ? {} : { isTracked: row.isTracked as boolean }),
      ...(row.targetUrl === undefined || row.targetUrl === null
        ? {}
        : { targetUrl: httpUrl(row.targetUrl) }),
      frequencies,
      cells
    };
  });
  return { dimension, dates, summary, trend, rows, page: pageValue(input.page) };
}

function rankReportAiAnswer(value: unknown): NonNullable<RankPositionReportCell["aiAnswer"]> {
  const item = exactRecord(value, [
    "snapshotId", "observedAt", "answerPresent", "siteFound", "position",
    "previousPosition", "rankingUrl", "brandFound"
  ]);
  if (
    typeof item.answerPresent !== "boolean" ||
    typeof item.siteFound !== "boolean" ||
    typeof item.brandFound !== "boolean"
  ) invalid();
  const position = item.position === undefined
    ? undefined
    : integer(item.position, 1, 100_000);
  const rankingUrl = item.rankingUrl === undefined || item.rankingUrl === null
    ? undefined
    : httpUrl(item.rankingUrl);
  if (
    item.siteFound !== (position !== undefined && rankingUrl !== undefined) ||
    (!item.answerPresent && (item.siteFound || item.brandFound))
  ) invalid();
  return {
    snapshotId: uuid(item.snapshotId),
    observedAt: instant(item.observedAt),
    answerPresent: item.answerPresent,
    siteFound: item.siteFound,
    ...(position === undefined ? {} : { position }),
    ...(item.previousPosition === undefined
      ? {}
      : { previousPosition: integer(item.previousPosition, 1, 100_000) }),
    ...(rankingUrl === undefined ? {} : { rankingUrl }),
    brandFound: item.brandFound
  };
}

/** Rebuilds the internal SERP workbench response through a bounded allowlist. */
export function parseSerpWorkbenchReport(value: unknown): SerpWorkbenchReport {
  const input = exactRecord(value, ["dimensions", "rows", "page"]);
  if (!Array.isArray(input.dimensions) || input.dimensions.length < 1 || input.dimensions.length > rankWorkbenchMaxDimensions) invalid();
  const dimensions = input.dimensions.map(rankDimension);
  const dimensionKeys = new Set(dimensions.map(({ key }) => key));
  if (dimensionKeys.size !== dimensions.length || !Array.isArray(input.rows) || input.rows.length > 200) invalid();
  const keywordIds = new Set<string>();
  const rows = input.rows.map((value) => {
    const row = exactRecord(value, ["keywordId", "version", "query", "language", "groupPath", "tags", "targetUrl", "snapshots", "aiSnapshots"]);
    const keywordId = uuid(row.keywordId);
    if (keywordIds.has(keywordId) || !Array.isArray(row.tags) || row.tags.length > 50 || !Array.isArray(row.snapshots) || row.snapshots.length > dimensions.length || !Array.isArray(row.aiSnapshots) || row.aiSnapshots.length > dimensions.length) invalid();
    keywordIds.add(keywordId);
    const snapshotDimensions = new Set<string>();
    const snapshots = row.snapshots.map((value) => {
      const snapshot = exactRecord(value, ["dimensionKey", "snapshotId", "observedAt", "provider", "results"]);
      const dimensionKey = rankDimensionKey(snapshot.dimensionKey);
      if (!dimensionKeys.has(dimensionKey) || snapshotDimensions.has(dimensionKey) || !serpWorkbenchSnapshotProviders.includes(snapshot.provider as SerpWorkbenchSnapshotProvider) || !Array.isArray(snapshot.results) || snapshot.results.length > 100) invalid();
      snapshotDimensions.add(dimensionKey);
      let previousPosition = 0;
      const results = snapshot.results.map((value) => {
        const result = exactRecord(value, ["position", "url", "faviconUrl", "title", "snippet"]);
        const position = integer(result.position, 1, 100);
        if (position <= previousPosition) invalid();
        previousPosition = position;
        return {
          position,
          url: httpUrl(result.url),
          ...(result.faviconUrl === undefined ? {} : { faviconUrl: httpUrl(result.faviconUrl) }),
          ...(result.title === undefined ? {} : { title: boundedText(result.title, 4_000) }),
          ...(result.snippet === undefined ? {} : { snippet: boundedText(result.snippet, 12_000) })
        };
      });
      return {
        dimensionKey,
        snapshotId: uuid(snapshot.snapshotId),
        observedAt: instant(snapshot.observedAt),
        provider: snapshot.provider as SerpWorkbenchSnapshotProvider,
        results
      };
    });
    const aiSnapshotDimensions = new Set<string>();
    const aiSnapshots = row.aiSnapshots.map((value) => {
      const snapshot = exactRecord(value, ["dimensionKey", "snapshotId", "observedAt", "provider", "results"]);
      const dimensionKey = rankDimensionKey(snapshot.dimensionKey);
      if (!dimensionKeys.has(dimensionKey) || aiSnapshotDimensions.has(dimensionKey) || snapshot.provider !== "ARSENKIN" || !Array.isArray(snapshot.results) || snapshot.results.length > 100) invalid();
      aiSnapshotDimensions.add(dimensionKey);
      let previousPosition = 0;
      const results = snapshot.results.map((value) => {
        const result = exactRecord(value, ["position", "url", "faviconUrl", "title", "snippet"]);
        const position = integer(result.position, 1, 100);
        if (position <= previousPosition) invalid();
        previousPosition = position;
        return {
          position,
          url: httpUrl(result.url),
          ...(result.faviconUrl === undefined ? {} : { faviconUrl: httpUrl(result.faviconUrl) }),
          ...(result.title === undefined ? {} : { title: boundedText(result.title, 4_000) }),
          ...(result.snippet === undefined ? {} : { snippet: boundedText(result.snippet, 12_000) })
        };
      });
      return {
        dimensionKey,
        snapshotId: uuid(snapshot.snapshotId),
        observedAt: instant(snapshot.observedAt),
        provider: "ARSENKIN" as const,
        results
      };
    });
    const tags = row.tags.map((tag) => boundedText(tag, 160));
    if (new Set(tags).size !== tags.length) invalid();
    return {
      keywordId,
      version: integer(row.version, 1, 2_147_483_647),
      query: boundedText(row.query, 20_000),
      language: locale(row.language),
      ...(row.groupPath === undefined ? {} : { groupPath: boundedText(row.groupPath, 4_096) }),
      tags,
      ...(row.targetUrl === undefined ? {} : { targetUrl: httpUrl(row.targetUrl) }),
      snapshots,
      aiSnapshots
    };
  });
  return { dimensions, rows, page: pageValue(input.page) };
}

export function parseRankDimensionHistoryDeletion(
  value: unknown
): RankDimensionHistoryDeletion {
  const input = exactRecord(value, ["id", "dimension", "excludedThrough", "affectedSnapshots", "createdAt"]);
  return {
    id: uuid(input.id),
    dimension: rankDimension(input.dimension),
    excludedThrough: instant(input.excludedThrough),
    affectedSnapshots: integer(input.affectedSnapshots, 0, Number.MAX_SAFE_INTEGER),
    createdAt: instant(input.createdAt)
  };
}

function keywordScope(
  input: Readonly<Record<string, unknown>>
): RankWorkbenchKeywordScope {
  const groupIds = input.groupIds === undefined
    ? undefined
    : uuidList(input.groupIds);
  const search = input.search === undefined
    ? undefined
    : boundedText(input.search, 200);
  const cursor = input.cursor === undefined
    ? undefined
    : boundedToken(input.cursor, 4_096);
  return {
    limit: member(input.limit, rankWorkbenchPageSizes),
    ...(groupIds && groupIds.length > 0 ? { groupIds } : {}),
    ...(search ? { search } : {}),
    ...(cursor ? { cursor } : {})
  } as RankWorkbenchKeywordScope;
}

function rankDimensionKey(value: unknown): string {
  if (typeof value !== "string" || !parseSemanticRankDimensionKey(value)) {
    invalid();
  }
  return value;
}

function uuidList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 2_000) invalid();
  const result = value.map((item) => {
    if (typeof item !== "string" || !UUID_PATTERN.test(item)) invalid();
    return item.toLowerCase();
  });
  if (new Set(result).size !== result.length) invalid();
  return result;
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const input = value as Readonly<Record<string, unknown>>;
  if (Object.keys(input).some((key) => !fields.includes(key))) invalid();
  return input;
}

function member<const Values extends readonly (string | number)[]>(
  value: unknown,
  values: Values
): Values[number] {
  if (!values.some((candidate) => candidate === value)) invalid();
  return value as Values[number];
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    invalid();
  }
  return Number(value);
}

function instant(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    new Date(value).toISOString() !== value
  ) invalid();
  return value;
}

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== "string") invalid();
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > maximum) invalid();
  return normalized;
}

function boundedToken(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) invalid();
  return value;
}

function rankDimension(value: unknown): SemanticRankDimension {
  const input = exactRecord(value, ["key", "searchEngine", "countryCode", "regionCode", "regionLabel", "language", "device"]);
  const dimension = parseSemanticRankDimensionKey(input.key);
  if (
    !dimension ||
    input.searchEngine !== dimension.searchEngine ||
    input.countryCode !== dimension.countryCode ||
    input.regionCode !== dimension.regionCode ||
    input.language !== dimension.language ||
    input.device !== dimension.device
  ) invalid();
  return {
    ...dimension,
    ...(input.regionLabel === undefined
      ? {}
      : { regionLabel: boundedText(input.regionLabel, 160) })
  };
}

function calendarDateList(value: unknown, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  const dates = value.map(calendarDate);
  if (new Set(dates).size !== dates.length) invalid();
  if (dates.some((date, index) => index > 0 && date >= (dates[index - 1] ?? ""))) invalid();
  return dates;
}

function calendarDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value
  ) invalid();
  return value;
}

function pageValue(value: unknown): RankPositionReport["page"] {
  const input = exactRecord(value, ["hasNext", "nextCursor", "totalApprox"]);
  if (typeof input.hasNext !== "boolean") invalid();
  const nextCursor = input.nextCursor === undefined
    ? undefined
    : boundedToken(input.nextCursor, 4_096);
  if (input.hasNext !== (nextCursor !== undefined)) invalid();
  return {
    hasNext: input.hasNext,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    ...(input.totalApprox === undefined
      ? {}
      : { totalApprox: integer(input.totalApprox, 0, Number.MAX_SAFE_INTEGER) })
  };
}

function finiteNumber(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) invalid();
  return value;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid();
  return value.toLowerCase();
}

function locale(value: unknown): string {
  if (typeof value !== "string" || value.length < 2 || value.length > 16) invalid();
  try {
    if (Intl.getCanonicalLocales(value)[0] !== value) invalid();
  } catch {
    invalid();
  }
  return value;
}

function unsignedDecimal(value: unknown): string {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,18})$/u.test(value)) invalid();
  return value;
}

function httpUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4_096) invalid();
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) invalid();
  } catch {
    invalid();
  }
  return value;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function invalid(): never {
  throw new TypeError("Invalid rank workbench payload");
}
