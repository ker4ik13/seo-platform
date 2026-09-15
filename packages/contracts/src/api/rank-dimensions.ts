import type { SemanticKeywordListPosition } from "./keywords.js";

/** A comparison identity is geographic, independent of mutable profile names. */
export interface SemanticRankDimension {
  readonly key: string;
  readonly searchEngine: "YANDEX" | "GOOGLE";
  readonly countryCode: string;
  readonly regionCode: string;
  readonly regionLabel?: string;
  readonly language: string;
  readonly device: "DESKTOP" | "MOBILE";
}

export interface SemanticRankDimensionCatalog {
  readonly dimensions: readonly SemanticRankDimension[];
  readonly aiDimensions?: readonly SemanticRankDimension[];
  readonly truncated: boolean;
}

export interface SemanticRankDimensionMetadata {
  readonly dimensionKey?: string;
  readonly regionCode?: string;
  readonly regionLabel?: string;
  readonly countryCode?: string;
  readonly language?: string;
  readonly device?: "DESKTOP" | "MOBILE";
}

export function parseSemanticRankDimensionMetadata(value: unknown): SemanticRankDimensionMetadata {
  const item = record(value);
  if (item.dimensionKey === undefined) return {};
  const dimension = parseSemanticRankDimensionKey(item.dimensionKey);
  if (!dimension || ["searchEngine", "countryCode", "regionCode", "language", "device"].some(key => item[key] !== undefined && item[key] !== dimension[key as keyof SemanticRankDimension])) throw new TypeError("Rank dimension metadata mismatch");
  const { key, searchEngine: _engine, ...metadata } = dimension;
  const regionLabel = optionalText(item.regionLabel, 160);
  return { dimensionKey: key, ...metadata, ...(regionLabel === undefined ? {} : { regionLabel }) };
}

export type SemanticRankColumnMetric =
  | "position"
  | "url"
  | "checkedAt"
  | "aiPosition"
  | "aiUrl"
  | "aiCheckedAt";
export type SemanticRankColumnKey = `rank:${string}:${SemanticRankColumnMetric}`;
export const semanticRankComparisonMaxDimensions = 24;
export const semanticRankComparisonMaxKeywords = 1_000;
export const semanticRankComparisonMaxCells = 2_000;

export interface SemanticRankComparisonInput {
  readonly keywordIds: readonly string[];
  readonly dimensionKeys: readonly string[];
  /** Omit for the complete legacy projection; tables without AI columns send false. */
  readonly includeAi?: boolean;
}

export interface SemanticRankComparisonItem extends SemanticKeywordListPosition {
  readonly keywordId: string;
  readonly dimensionKey: string;
  readonly snapshotId: string;
  readonly trackingContextId: string;
  readonly configurationVersion: number;
  readonly jobId: string;
  readonly provider: string;
  readonly searchSource?: "LIVE" | "SEARCH_API";
  readonly depth: number;
  /** Number of distinct project pages in this exact latest snapshot. */
  readonly siteResultCount: number;
  readonly title?: string;
  readonly snippet?: string;
  readonly aiAnswer?: Readonly<{
    snapshotId: string;
    answerPresent: boolean;
    siteFound: boolean;
    position?: number;
    previousPosition?: number;
    rankingUrl?: string;
    brandFound: boolean;
    observedAt: string;
    provider: "ARSENKIN";
  }>;
}

export function semanticRankDimensionKey(value: Omit<SemanticRankDimension, "key">): string {
  return [value.searchEngine, value.countryCode, value.regionCode, value.language, value.device].map(encodeURIComponent).join("|");
}

export function parseSemanticRankDimensionKey(value: unknown): SemanticRankDimension | undefined {
  if (typeof value !== "string" || value.length > 1_000) return undefined;
  try {
    const parts = value.split("|").map(decodeURIComponent);
    const [searchEngine, countryCode, regionCode, language, device] = parts;
    if (parts.length !== 5 || (searchEngine !== "YANDEX" && searchEngine !== "GOOGLE") ||
      !countryCode || !/^[A-Z]{2}$/u.test(countryCode) || !regionCode || regionCode.length > 100 || [...regionCode].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127) ||
      !language || language.length > 16 || Intl.getCanonicalLocales(language)[0] !== language ||
      (device !== "DESKTOP" && device !== "MOBILE")) return undefined;
    const dimension: SemanticRankDimension = { key: value, searchEngine, countryCode, regionCode, language, device };
    return semanticRankDimensionKey(dimension) === value ? dimension : undefined;
  } catch { return undefined; }
}

export function semanticRankColumnKey(dimensionKey: string, metric: SemanticRankColumnMetric): SemanticRankColumnKey {
  if (!parseSemanticRankDimensionKey(dimensionKey)) throw new TypeError("Invalid rank dimension");
  return `rank:${dimensionKey}:${metric}`;
}

export function parseSemanticRankColumnKey(value: unknown): Readonly<{ dimension: SemanticRankDimension; metric: SemanticRankColumnMetric }> | undefined {
  if (typeof value !== "string" || !value.startsWith("rank:")) return undefined;
  const delimiter = value.lastIndexOf(":"), metric = value.slice(delimiter + 1);
  if (!["position", "url", "checkedAt", "aiPosition", "aiUrl", "aiCheckedAt"].includes(metric)) return undefined;
  const dimension = parseSemanticRankDimensionKey(value.slice(5, delimiter));
  return dimension ? { dimension, metric: metric as SemanticRankColumnMetric } : undefined;
}

export function parseSemanticRankComparisonInput(value: unknown): SemanticRankComparisonInput {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => key !== "keywordIds" && key !== "dimensionKeys" && key !== "includeAi")) throw new TypeError("Invalid comparison input");
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.keywordIds) || input.keywordIds.length < 1 || input.keywordIds.length > semanticRankComparisonMaxKeywords ||
    input.keywordIds.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)) ||
    new Set(input.keywordIds).size !== input.keywordIds.length ||
    !Array.isArray(input.dimensionKeys) || input.dimensionKeys.length < 1 || input.dimensionKeys.length > semanticRankComparisonMaxDimensions ||
    input.dimensionKeys.some(key => !parseSemanticRankDimensionKey(key)) || new Set(input.dimensionKeys).size !== input.dimensionKeys.length || input.keywordIds.length * input.dimensionKeys.length > semanticRankComparisonMaxCells ||
    (input.includeAi !== undefined && typeof input.includeAi !== "boolean")) throw new TypeError("Invalid comparison scope");
  return {
    keywordIds: [...input.keywordIds] as string[],
    dimensionKeys: [...input.dimensionKeys] as string[],
    ...(input.includeAi === undefined ? {} : { includeAi: input.includeAi })
  };
}

/** Rebuild trusted responses through an allowlist before exposing them to Web. */
export function parseSemanticRankDimensionCatalog(value: unknown): SemanticRankDimensionCatalog {
  const input = record(value);
  if (!Array.isArray(input.dimensions) || input.dimensions.length > 2_000 ||
    (input.aiDimensions !== undefined && (!Array.isArray(input.aiDimensions) || input.aiDimensions.length > 2_000)) ||
    typeof input.truncated !== "boolean") throw new TypeError("Invalid dimension catalog");
  const dimensions = rankDimensionCatalogItems(input.dimensions);
  const aiDimensions = input.aiDimensions === undefined
    ? undefined
    : rankDimensionCatalogItems(input.aiDimensions);
  return {
    dimensions,
    ...(aiDimensions === undefined ? {} : { aiDimensions }),
    truncated: input.truncated
  };
}

function rankDimensionCatalogItems(values: readonly unknown[]): readonly SemanticRankDimension[] {
  const seen = new Set<string>();
  return values.map(value => {
    const item = record(value), dimension = parseSemanticRankDimensionKey(item.key);
    if (!dimension || seen.has(dimension.key) || ["searchEngine", "countryCode", "regionCode", "language", "device"].some(key => item[key] !== dimension[key as keyof SemanticRankDimension])) throw new TypeError("Invalid dimension");
    seen.add(dimension.key);
    const regionLabel = optionalText(item.regionLabel, 160);
    return { ...dimension, ...(regionLabel === undefined ? {} : { regionLabel }) };
  });
}

export function parseSemanticRankComparisonItems(value: unknown, scope: SemanticRankComparisonInput): readonly SemanticRankComparisonItem[] {
  if (!Array.isArray(value) || value.length > scope.keywordIds.length * scope.dimensionKeys.length) throw new TypeError("Invalid rank comparison");
  const keywords = new Set(scope.keywordIds), dimensions = new Set(scope.dimensionKeys), seen = new Set<string>();
  return value.map(value => {
    const item = record(value), keywordId = identifier(item.keywordId), dimensionKey = requiredText(item.dimensionKey, 1_000);
    const dimension = parseSemanticRankDimensionKey(dimensionKey), identity = `${keywordId}:${dimensionKey}`;
    if (!keywords.has(keywordId) || !dimensions.has(dimensionKey) || !dimension || seen.has(identity) || item.searchEngine !== dimension.searchEngine || typeof item.found !== "boolean") throw new TypeError("Rank comparison scope mismatch");
    seen.add(identity);
    const position = item.position === undefined ? undefined : integer(item.position, 1, 100);
    if (item.found !== (position !== undefined)) throw new TypeError("Invalid rank position");
    const previousPosition = item.previousPosition === undefined ? undefined : integer(item.previousPosition, 1, 100);
    const rankingUrl = optionalText(item.rankingUrl, 4_096);
    if (rankingUrl !== undefined) { const url = new URL(rankingUrl); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new TypeError("Invalid rank URL"); }
    if (!item.found && rankingUrl !== undefined) throw new TypeError("Unexpected missing rank URL");
    const observedAt = requiredText(item.observedAt, 24);
    if (new Date(observedAt).toISOString() !== observedAt) throw new TypeError("Invalid observed time");
    const provider = requiredText(item.provider, 32);
    if (!/^[A-Z_]+$/u.test(provider)) throw new TypeError("Invalid rank provider");
    const source = item.searchSource;
    if (source !== undefined && source !== "LIVE" && source !== "SEARCH_API") throw new TypeError("Invalid search source");
    const title = optionalText(item.title, 2_048), snippet = optionalText(item.snippet, 8_192);
    const aiAnswer = item.aiAnswer === undefined
      ? undefined
      : parsedAiAnswer(item.aiAnswer);
    return {
      keywordId, dimensionKey, searchEngine: dimension.searchEngine, found: item.found,
      ...(position === undefined ? {} : { position }), ...(previousPosition === undefined ? {} : { previousPosition }),
      ...(rankingUrl === undefined ? {} : { rankingUrl }), observedAt,
      snapshotId: identifier(item.snapshotId), trackingContextId: identifier(item.trackingContextId),
      configurationVersion: integer(item.configurationVersion, 1, 2_147_483_647), jobId: identifier(item.jobId),
      provider, depth: integer(item.depth, 1, 100),
      siteResultCount: integer(item.siteResultCount, 0, 100),
      ...(source === undefined ? {} : { searchSource: source }),
      ...(title === undefined ? {} : { title }), ...(snippet === undefined ? {} : { snippet }),
      ...(aiAnswer === undefined ? {} : { aiAnswer })
    };
  });
}

function parsedAiAnswer(
  value: unknown
): NonNullable<SemanticRankComparisonItem["aiAnswer"]> {
  const item = record(value);
  if (
    typeof item.answerPresent !== "boolean" ||
    typeof item.siteFound !== "boolean" ||
    typeof item.brandFound !== "boolean" ||
    item.provider !== "ARSENKIN"
  ) throw new TypeError("Invalid AI answer comparison");
  const position = item.position === undefined
    ? undefined
    : integer(item.position, 1, 100_000);
  const previousPosition = item.previousPosition === undefined
    ? undefined
    : integer(item.previousPosition, 1, 100_000);
  const rankingUrl = optionalText(item.rankingUrl, 4_096);
  if (
    item.siteFound !== (position !== undefined && rankingUrl !== undefined) ||
    (!item.answerPresent && (item.siteFound || item.brandFound))
  ) throw new TypeError("Invalid AI answer comparison");
  if (rankingUrl !== undefined) {
    const url = new URL(rankingUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
      throw new TypeError("Invalid AI answer URL");
    }
  }
  const observedAt = requiredText(item.observedAt, 24);
  if (new Date(observedAt).toISOString() !== observedAt) {
    throw new TypeError("Invalid AI answer time");
  }
  return {
    snapshotId: identifier(item.snapshotId),
    answerPresent: item.answerPresent,
    siteFound: item.siteFound,
    ...(position === undefined ? {} : { position }),
    ...(previousPosition === undefined ? {} : { previousPosition }),
    ...(rankingUrl === undefined ? {} : { rankingUrl }),
    brandFound: item.brandFound,
    observedAt,
    provider: "ARSENKIN"
  };
}

function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid record"); return value as Record<string, unknown>; }
function requiredText(value: unknown, max: number): string { if (typeof value !== "string" || !value || value.length > max) throw new TypeError("Invalid text"); return value; }
function optionalText(value: unknown, max: number): string | undefined { return value === undefined ? undefined : requiredText(value, max); }
function identifier(value: unknown): string { const text = requiredText(value, 36); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(text)) throw new TypeError("Invalid identifier"); return text; }
function integer(value: unknown, min: number, max: number): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new TypeError("Invalid integer"); return value; }
