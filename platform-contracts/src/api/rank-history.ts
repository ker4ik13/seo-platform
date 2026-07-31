import type {
  NormalizedRankDataQualityFlag,
  RankManifestHash
} from "./rank-runs.js";

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

interface RankHistoryItemBase {
  readonly snapshotId: string;
  readonly keywordId: string;
  readonly trackingContextId: string;
  readonly configurationVersion: number;
  readonly provider: "ARSENKIN";
  readonly connectorVersion: string;
  readonly observedAt: string;
  readonly storedAt: string;
  readonly jobId: string;
  readonly dataQualityFlags: readonly NormalizedRankDataQualityFlag[];
}

export interface RankHistoryFoundItem extends RankHistoryItemBase {
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
  "SNIPPET_UNAVAILABLE"
]);
const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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
  if (
    input.provider !== "ARSENKIN" ||
    typeof input.snapshotId !== "string" ||
    !UUID_V7_PATTERN.test(input.snapshotId) ||
    typeof input.keywordId !== "string" ||
    !UUID_V7_PATTERN.test(input.keywordId) ||
    typeof input.trackingContextId !== "string" ||
    !UUID_V7_PATTERN.test(input.trackingContextId) ||
    typeof input.jobId !== "string" ||
    !UUID_V7_PATTERN.test(input.jobId) ||
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
  const base: RankHistoryItemBase = {
    snapshotId: input.snapshotId,
    keywordId: input.keywordId,
    trackingContextId: input.trackingContextId,
    configurationVersion: input.configurationVersion,
    provider: input.provider,
    connectorVersion: input.connectorVersion,
    observedAt: input.observedAt,
    storedAt: input.storedAt,
    jobId: input.jobId,
    dataQualityFlags
  };

  if (input.found === false) {
    if (
      input.position !== null ||
      NOT_FOUND_ONLY_FORBIDDEN_KEYS.some((key) => key in input) ||
      dataQualityFlags.some(
        (flag) => flag !== "PROVIDER_OBSERVED_AT_UNAVAILABLE"
      )
    ) {
      return invalidRankHistoryItem();
    }
    return {
      ...base,
      found: false,
      position: null
    };
  }

  if (
    input.found !== true ||
    !Number.isSafeInteger(input.position) ||
    input.position < 1 ||
    input.position > 30 ||
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
  assertAvailabilityFlag(
    dataQualityFlags,
    "ABSOLUTE_POSITION_UNAVAILABLE",
    input.absolutePosition === undefined
  );
  assertAvailabilityFlag(
    dataQualityFlags,
    "PIXEL_POSITION_UNAVAILABLE",
    input.pixelPosition === undefined
  );
  assertAvailabilityFlag(
    dataQualityFlags,
    "TITLE_UNAVAILABLE",
    input.title === undefined
  );
  assertAvailabilityFlag(
    dataQualityFlags,
    "SNIPPET_UNAVAILABLE",
    input.snippet === undefined
  );

  return {
    ...base,
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

function copyQualityFlags(
  flags: readonly NormalizedRankDataQualityFlag[]
): readonly NormalizedRankDataQualityFlag[] {
  if (flags.length > QUALITY_FLAGS.size) {
    return invalidRankHistoryItem();
  }
  const seen = new Set<string>();
  const copied: NormalizedRankDataQualityFlag[] = [];
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
  flags: readonly NormalizedRankDataQualityFlag[],
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
