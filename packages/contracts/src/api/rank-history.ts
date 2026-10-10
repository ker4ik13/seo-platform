import type {
  NormalizedRankDataQualityFlag,
  RankManifestHash
} from "./rank-runs.js";
import type { SemanticKeywordListSiteResult } from "./keywords.js";
import { parseSemanticRankDimensionMetadata, type SemanticRankDimensionMetadata } from "./rank-dimensions.js";

export const rankHistoryMaxPageSize = 200 as const;

/**
 * Public project-scoped query. workspaceId, projectId and actorId are never
 * accepted from the client body/query: Platform API derives them from the
 * authenticated route context and creates InternalRankHistoryQuery.
 *
 * The observed time range is mandatory so every history query includes the
 * partition key. observedFrom is inclusive and observedBefore is exclusive.
 * Results have one immutable order: observedAt DESC, snapshotId DESC.
 */
export interface RankHistoryQuery {
  readonly observedFrom: string;
  readonly observedBefore: string;
  readonly trackingContextId?: string;
  readonly keywordId?: string;
  readonly dimensionKey?: string;
  /** SERP includes competitor-only runs and their complete stored organic results. */
  readonly mode?: "SERP";
  readonly limit: number;
  readonly cursor?: string;
}

/**
 * Trusted Platform API -> SEO Data route contract. All IDs are canonical
 * lowercase UUIDv7 and must agree with the internal route and trusted
 * headers. actorId is authorization/audit context, not an ownership filter.
 */
export interface InternalRankHistoryQuery extends RankHistoryQuery {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
}

export type RankHistoryDataQualityFlag = NormalizedRankDataQualityFlag | "IMPORTED_KC4" | "IMPORTED_MANUAL_HISTORY";

interface RankHistoryItemBase extends SemanticRankDimensionMetadata {
  readonly snapshotId: string;
  readonly keywordId: string;
  readonly trackingContextId: string;
  readonly configurationVersion: number;
  readonly provider: "ARSENKIN" | "XMLSTOCK" | "KEY_COLLECTOR" | "MANUAL_IMPORT";
  readonly connectorVersion: string;
  readonly contextName?: string;
  readonly searchEngine?: "GOOGLE" | "YANDEX";
  readonly searchSource?: "LIVE" | "SEARCH_API";
  readonly regionLabel?: string;
  readonly observedAt: string;
  readonly storedAt: string;
  readonly jobId: string;
  readonly dataQualityFlags: readonly RankHistoryDataQualityFlag[];
  /** All pages of the tracked project found in this immutable SERP, with safe SERP metadata. */
  readonly siteResults?: readonly SemanticKeywordListSiteResult[];
  readonly serpResults?: readonly SemanticKeywordListSiteResult[];
  readonly depth?: number;
}

export interface RankHistoryProviderFoundItem extends RankHistoryItemBase {
  readonly provider: "ARSENKIN" | "XMLSTOCK" | "KEY_COLLECTOR";
  readonly found: true;
  readonly position: number;
  readonly absolutePosition?: number;
  readonly pixelPosition?: number;
  readonly rankingUrl: string;
  readonly normalizedRankingUrl: string;
  readonly title?: string;
  readonly snippet?: string;
  readonly resultType: "ORGANIC";
  readonly serpFeatures: readonly [];
}

/** A manual import may include a URL, but never invents a provider SERP payload. */
export interface RankHistoryManualFoundItem extends RankHistoryItemBase {
  readonly provider: "MANUAL_IMPORT";
  readonly found: true;
  readonly position: number;
  readonly absolutePosition?: never;
  readonly pixelPosition?: never;
  readonly rankingUrl?: string;
  readonly normalizedRankingUrl?: string;
  readonly title?: never;
  readonly snippet?: never;
  readonly resultType?: never;
  readonly serpFeatures?: never;
}

export type RankHistoryFoundItem =
  | RankHistoryProviderFoundItem
  | RankHistoryManualFoundItem;

export interface RankHistoryNotFoundItem extends RankHistoryItemBase {
  readonly found: false;
  readonly position: null;
  readonly absolutePosition?: never;
  readonly pixelPosition?: never;
  readonly rankingUrl?: never;
  readonly normalizedRankingUrl?: never;
  readonly title?: never;
  readonly snippet?: never;
  readonly resultType?: never;
  readonly serpFeatures?: never;
}

/**
 * Permission-protected project history projection. It intentionally omits
 * workspace/project IDs (already expressed by the public route), manifest
 * and manifest-entry IDs, assignment ID, provider request ID, credential/
 * binding identifiers and raw provider payload.
 */
export type RankHistoryItem =
  | RankHistoryFoundItem
  | RankHistoryNotFoundItem;

export interface RankHistoryCursorPage {
  readonly hasNext: boolean;
  readonly nextCursor?: string;
}

/**
 * Tenant-bound internal response. Platform API validates workspace/project
 * against its trusted context and then emits only items/page publicly.
 */
export interface InternalRankHistoryCollection {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly items: readonly RankHistoryItem[];
  readonly page: RankHistoryCursorPage;
}

/**
 * Canonical filter identity used to bind an opaque cursor to one tenant,
 * project, time range and optional entity filters. Page size and cursor are
 * deliberately absent so callers may reduce a page size without changing
 * the logical result set.
 */
export interface InternalRankHistoryFilterHashPreimage {
  readonly schemaVersion: "rank-history-filter@1";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly observedFrom: string;
  readonly observedBefore: string;
  readonly trackingContextId: string | null;
  readonly keywordId: string | null;
  readonly dimensionKey?: string;
  readonly mode?: "SERP";
}

/**
 * Decoded server-side keyset. The externally returned cursor is an opaque,
 * authenticated encoding owned by SEO Data; clients never construct or
 * modify this payload. No offset exists in this contract.
 */
export interface InternalRankHistoryCursorV1 {
  readonly schemaVersion: "rank-history-cursor@1";
  readonly workspaceId: string;
  readonly projectId: string;
  readonly filterHash: RankManifestHash;
  readonly observedAt: string;
  readonly snapshotId: string;
}

const QUALITY_FLAGS: ReadonlySet<string> = new Set([
  "PROVIDER_OBSERVED_AT_UNAVAILABLE",
  "ABSOLUTE_POSITION_UNAVAILABLE",
  "PIXEL_POSITION_UNAVAILABLE",
  "TITLE_UNAVAILABLE",
  "SNIPPET_UNAVAILABLE",
  "IMPORTED_KC4",
  "IMPORTED_MANUAL_HISTORY"
]);
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONNECTOR_VERSION_PATTERN = /^[a-z0-9][a-z0-9@._-]{0,63}$/u;
const MAX_URL_LENGTH = 4_096;
const MAX_TITLE_LENGTH = 2_048;
const MAX_SNIPPET_LENGTH = 8_192;

const NOT_FOUND_ONLY_FORBIDDEN_KEYS = [
  "absolutePosition",
  "pixelPosition",
  "rankingUrl",
  "normalizedRankingUrl",
  "title",
  "snippet",
  "resultType",
  "serpFeatures"
] as const;

/**
 * Rebuilds a public history row through an explicit allowlist so private
 * storage/provider fields on a structurally compatible object cannot cross
 * Platform API. Owning services still validate UUIDs, timestamps and URL
 * normalization on their trust boundaries.
 */
export function redactRankHistoryItem(
  input: RankHistoryItem
): RankHistoryItem {
  const technicalIdPattern = input.provider === "MANUAL_IMPORT" || input.provider === "KEY_COLLECTOR"
    ? UUID_PATTERN
    : UUID_V7_PATTERN;
  if (
    !["ARSENKIN", "XMLSTOCK", "KEY_COLLECTOR", "MANUAL_IMPORT"].includes(input.provider) ||
    typeof input.snapshotId !== "string" ||
    !technicalIdPattern.test(input.snapshotId) ||
    typeof input.keywordId !== "string" ||
    !UUID_V7_PATTERN.test(input.keywordId) ||
    typeof input.trackingContextId !== "string" ||
    !technicalIdPattern.test(input.trackingContextId) ||
    typeof input.jobId !== "string" ||
    !technicalIdPattern.test(input.jobId) ||
    typeof input.connectorVersion !== "string" ||
    !CONNECTOR_VERSION_PATTERN.test(input.connectorVersion) ||
    !isCanonicalIsoInstant(input.observedAt) ||
    !isCanonicalIsoInstant(input.storedAt) ||
    !Number.isSafeInteger(input.configurationVersion) ||
    input.configurationVersion < 1 ||
    !Array.isArray(input.dataQualityFlags)
  ) {
    return invalidRankHistoryItem();
  }

  const dataQualityFlags = copyQualityFlags(input.dataQualityFlags);
  if (input.provider === "MANUAL_IMPORT"
    ? dataQualityFlags.length !== 1 || dataQualityFlags[0] !== "IMPORTED_MANUAL_HISTORY"
    : input.provider === "KEY_COLLECTOR"
      ? dataQualityFlags.length !== 1 || dataQualityFlags[0] !== "IMPORTED_KC4"
      : dataQualityFlags.some(flag => flag === "IMPORTED_KC4" || flag === "IMPORTED_MANUAL_HISTORY")) {
    return invalidRankHistoryItem();
  }
  assertOptionalBoundedString(input.contextName, 160);
  assertOptionalBoundedString(input.regionLabel, 160);
  if (
    (input.contextName === undefined) !== (input.searchEngine === undefined) ||
    (input.searchEngine !== undefined &&
      input.searchEngine !== "GOOGLE" &&
      input.searchEngine !== "YANDEX") ||
    (input.searchSource !== undefined &&
      (input.searchEngine === undefined ||
        (input.searchSource !== "LIVE" &&
          input.searchSource !== "SEARCH_API"))) ||
    (input.regionLabel !== undefined && input.searchEngine === undefined)
  ) {
    return invalidRankHistoryItem();
  }
  const siteResults = copySiteResults(input.siteResults);
  const serpResults = copySiteResults(input.serpResults, true);
  if (input.depth !== undefined && (!Number.isSafeInteger(input.depth) || input.depth < 1 || input.depth > 100)) return invalidRankHistoryItem();
  const base: RankHistoryItemBase = {
    ...parseSemanticRankDimensionMetadata(input),
    snapshotId: input.snapshotId,
    keywordId: input.keywordId,
    trackingContextId: input.trackingContextId,
    configurationVersion: input.configurationVersion,
    provider: input.provider,
    connectorVersion: input.connectorVersion,
    ...(input.contextName === undefined
      ? {}
      : { contextName: input.contextName }),
    ...(input.searchEngine === undefined
      ? {}
      : { searchEngine: input.searchEngine }),
    ...(input.searchSource === undefined
      ? {}
      : { searchSource: input.searchSource }),
    ...(input.regionLabel === undefined
      ? {}
      : { regionLabel: input.regionLabel }),
    observedAt: input.observedAt,
    storedAt: input.storedAt,
    jobId: input.jobId,
    dataQualityFlags,
    ...(siteResults === undefined ? {} : { siteResults }),
    ...(serpResults === undefined ? {} : { serpResults }),
    ...(input.depth === undefined ? {} : { depth: input.depth })
  };

  if (input.found === false) {
    if (
      input.position !== null ||
      NOT_FOUND_ONLY_FORBIDDEN_KEYS.some((key) => key in input) ||
      (!["MANUAL_IMPORT", "KEY_COLLECTOR"].includes(input.provider) && dataQualityFlags.some(
        (flag) => flag !== "PROVIDER_OBSERVED_AT_UNAVAILABLE"
      ))
    ) {
      return invalidRankHistoryItem();
    }
    return {
      ...base,
      found: false,
      position: null
    };
  }

  if (input.provider === "MANUAL_IMPORT") {
    if (
      input.found !== true ||
      !Number.isSafeInteger(input.position) ||
      input.position < 1 ||
      input.position > 100 ||
      ["absolutePosition", "pixelPosition", "title", "snippet", "resultType", "serpFeatures"].some((key) => key in input) ||
      (input.rankingUrl === undefined) !== (input.normalizedRankingUrl === undefined)
    ) {
      return invalidRankHistoryItem();
    }
    if (input.rankingUrl !== undefined) { assertUrl(input.rankingUrl); assertUrl(input.normalizedRankingUrl!); }
    return {
      ...base,
      provider: "MANUAL_IMPORT",
      found: true,
      position: input.position,
      ...(input.rankingUrl === undefined ? {} : { rankingUrl: input.rankingUrl, normalizedRankingUrl: input.normalizedRankingUrl! }),
    };
  }

  if (input.provider === "KEY_COLLECTOR") {
    if (
      input.found !== true ||
      !Number.isSafeInteger(input.position) ||
      input.position < 1 ||
      input.position > 100 ||
      input.resultType !== "ORGANIC" ||
      !Array.isArray(input.serpFeatures) ||
      input.serpFeatures.length !== 0 ||
      ["absolutePosition", "pixelPosition", "title", "snippet"].some((key) => key in input)
    ) {
      return invalidRankHistoryItem();
    }
    assertUrl(input.rankingUrl);
    assertUrl(input.normalizedRankingUrl);
    return {
      ...base,
      provider: "KEY_COLLECTOR",
      found: true,
      position: input.position,
      rankingUrl: input.rankingUrl,
      normalizedRankingUrl: input.normalizedRankingUrl,
      resultType: "ORGANIC",
      serpFeatures: []
    };
  }

  if (
    input.found !== true ||
    !Number.isSafeInteger(input.position) ||
    input.position < 1 ||
    input.position > 100 ||
    input.resultType !== "ORGANIC" ||
    !Array.isArray(input.serpFeatures) ||
    input.serpFeatures.length !== 0
  ) {
    return invalidRankHistoryItem();
  }
  assertOptionalNonNegativeInteger(input.absolutePosition);
  assertOptionalNonNegativeInteger(input.pixelPosition);
  assertUrl(input.rankingUrl);
  assertUrl(input.normalizedRankingUrl);
  assertOptionalBoundedString(input.title, MAX_TITLE_LENGTH);
  assertOptionalBoundedString(input.snippet, MAX_SNIPPET_LENGTH);
  assertAvailabilityFlag(dataQualityFlags, "ABSOLUTE_POSITION_UNAVAILABLE", input.absolutePosition === undefined);
  assertAvailabilityFlag(dataQualityFlags, "PIXEL_POSITION_UNAVAILABLE", input.pixelPosition === undefined);
  assertAvailabilityFlag(dataQualityFlags, "TITLE_UNAVAILABLE", input.title === undefined);
  assertAvailabilityFlag(dataQualityFlags, "SNIPPET_UNAVAILABLE", input.snippet === undefined);

  return {
    ...base,
    provider: input.provider,
    found: true,
    position: input.position,
    ...(input.absolutePosition === undefined
      ? {}
      : { absolutePosition: input.absolutePosition }),
    ...(input.pixelPosition === undefined
      ? {}
      : { pixelPosition: input.pixelPosition }),
    rankingUrl: input.rankingUrl,
    normalizedRankingUrl: input.normalizedRankingUrl,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.snippet === undefined ? {} : { snippet: input.snippet }),
    resultType: input.resultType,
    serpFeatures: []
  };
}

function copySiteResults(
  values: readonly SemanticKeywordListSiteResult[] | undefined,
  allowRepeatedUrls = false
): readonly SemanticKeywordListSiteResult[] | undefined {
  if (values === undefined) return undefined;
  if (!Array.isArray(values) || values.length < 1 || values.length > 100) {
    return invalidRankHistoryItem();
  }
  let previousPosition = 0;
  const urls = new Set<string>();
  return values.map((value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      !Number.isSafeInteger(value.position) ||
      value.position < 1 ||
      value.position > 100 ||
      value.position <= previousPosition ||
      (!allowRepeatedUrls && urls.has(value.rankingUrl))
    ) {
      return invalidRankHistoryItem();
    }
    assertUrl(value.rankingUrl);
    if (value.faviconUrl !== undefined) assertUrl(value.faviconUrl);
    assertOptionalBoundedString(value.title, MAX_TITLE_LENGTH);
    assertOptionalBoundedString(value.snippet, MAX_SNIPPET_LENGTH);
    previousPosition = value.position;
    urls.add(value.rankingUrl);
    return {
      position: value.position,
      rankingUrl: value.rankingUrl,
      ...(value.faviconUrl === undefined
        ? {}
        : { faviconUrl: value.faviconUrl }),
      ...(value.title === undefined ? {} : { title: value.title }),
      ...(value.snippet === undefined ? {} : { snippet: value.snippet })
    };
  });
}

function copyQualityFlags(
  flags: readonly RankHistoryDataQualityFlag[]
): readonly RankHistoryDataQualityFlag[] {
  if (flags.length > QUALITY_FLAGS.size) {
    return invalidRankHistoryItem();
  }
  const seen = new Set<string>();
  const copied: RankHistoryDataQualityFlag[] = [];
  for (const flag of flags) {
    if (!QUALITY_FLAGS.has(flag) || seen.has(flag)) {
      return invalidRankHistoryItem();
    }
    seen.add(flag);
    copied.push(flag);
  }
  return copied;
}

function assertOptionalNonNegativeInteger(value: number | undefined): void {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    return invalidRankHistoryItem();
  }
}

function assertUrl(value: string): void {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_URL_LENGTH
  ) {
    return invalidRankHistoryItem();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidRankHistoryItem();
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return invalidRankHistoryItem();
  }
}

function assertOptionalBoundedString(
  value: string | undefined,
  maxLength: number
): void {
  if (
    value !== undefined &&
    (typeof value !== "string" ||
      value.length < 1 ||
      value.length > maxLength)
  ) {
    return invalidRankHistoryItem();
  }
}

function assertAvailabilityFlag(
  flags: readonly RankHistoryDataQualityFlag[],
  flag: NormalizedRankDataQualityFlag,
  expectedUnavailable: boolean
): void {
  if (flags.includes(flag) !== expectedUnavailable) {
    return invalidRankHistoryItem();
  }
}

function isCanonicalIsoInstant(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length === 24 &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function invalidRankHistoryItem(): never {
  throw new TypeError("Invalid rank history item");
}
