import { parseSemanticRankDimensionKey } from "./api/rank-dimensions.js";
import {
  canonicalJsonSha256,
  utf8Sha256
} from "./canonical-json.js";
import type {
  InternalFinalizeRankCheckInput,
  InternalNormalizedRankResult,
  InternalNormalizedRankSerpResult,
  InternalRankCheckFinalizationHashPreimage,
  InternalRankChunkIngestCommand,
  InternalRankChunkIngestHashPreimage,
  InternalRankManifestChunk,
  NormalizedRankDataQualityFlag,
  RankCheckFinalStatus,
  RankManifestHash
} from "./api/rank-runs.js";
import {
  rankManifestChunkHashPreimage,
  rankSerpResultMaxCount
} from "./api/rank-runs.js";
import {
  legacyRankManifestChunkSize,
  rankManifestSingleTaskChunkSize
} from "./api/rank-estimates.js";
import { batchedArsenkinRankChunkSize, rankCommandKeywordLimit } from "./api/rank-policy.js";
import type {
  InternalRankHistoryFilterHashPreimage,
  InternalRankHistoryQuery
} from "./api/rank-history.js";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const CONNECTOR_VERSION_PATTERN = /^[a-z0-9][a-z0-9@._-]{0,63}$/u;
const PROVIDER_REQUEST_ID_PATTERN = /^[\x20-\x7e]{1,256}$/u;
const MAX_URL_LENGTH = 4_096;
const MAX_TITLE_LENGTH = 2_048;
const MAX_SNIPPET_LENGTH = 8_192;
const MAX_KEYWORD_CODE_POINTS = 500;
const MAX_KEYWORD_CODE_UNITS = MAX_KEYWORD_CODE_POINTS * 2;
const MAX_KEYWORD_UTF8_BYTES = 2_000;
const MAX_LANGUAGE_LENGTH = 16;
const ARSENKIN_RANK_CHUNK_MAX_INDEX = rankCommandKeywordLimit / batchedArsenkinRankChunkSize - 1;
const XMLSTOCK_RANK_CHUNK_MAX_INDEX =
  rankCommandKeywordLimit - 1;

const INGEST_COMMAND_KEYS = [
  "schemaVersion",
  "workspaceId",
  "projectId",
  "actorId",
  "jobId",
  "jobItemId",
  "manifestId",
  "chunkIndex",
  "manifestChunkHash",
  "provider",
  "operation",
  "providerRequestId",
  "connectorVersion",
  "observedAt",
  "results"
] as const;

const MANIFEST_CHUNK_KEYS = [
  "workspaceId",
  "projectId",
  "jobId",
  "manifestId",
  "chunkIndex",
  "hashSchemaVersion",
  "chunkHash",
  "entries"
] as const;

const MANIFEST_ENTRY_KEYS = [
  "id",
  "sequence",
  "assignmentId",
  "keywordId",
  "keywordVersion",
  "keywordText",
  "keywordTextHash",
  "language"
] as const;

const FOUND_RESULT_REQUIRED_KEYS = [
  "manifestEntryId",
  "keywordId",
  "dataQualityFlags",
  "found",
  "position",
  "rankingUrl",
  "normalizedRankingUrl",
  "resultType",
  "serpFeatures"
] as const;

const FOUND_RESULT_OPTIONAL_KEYS = [
  "absolutePosition",
  "pixelPosition",
  "title",
  "snippet",
  "serpResults"
] as const;

const NOT_FOUND_RESULT_KEYS = [
  "manifestEntryId",
  "keywordId",
  "dataQualityFlags",
  "found",
  "position"
] as const;

const NOT_FOUND_RESULT_OPTIONAL_KEYS = ["serpResults"] as const;

const SERP_RESULT_REQUIRED_KEYS = [
  "position",
  "rankingUrl",
  "normalizedRankingUrl"
] as const;

const SERP_RESULT_OPTIONAL_KEYS = [
  "faviconUrl",
  "title",
  "snippet"
] as const;

const FINALIZATION_INPUT_KEYS = [
  "schemaVersion",
  "workspaceId",
  "projectId",
  "actorId",
  "jobId",
  "manifestId",
  "status"
] as const;

const HISTORY_QUERY_REQUIRED_KEYS = [
  "workspaceId",
  "projectId",
  "actorId",
  "observedFrom",
  "observedBefore",
  "limit"
] as const;

const HISTORY_QUERY_OPTIONAL_KEYS = [
  "dimensionKey",
  "mode",
  "trackingContextId",
  "keywordId",
  "cursor"
] as const;

const QUALITY_FLAG_ORDER = [
  "PROVIDER_OBSERVED_AT_UNAVAILABLE",
  "ABSOLUTE_POSITION_UNAVAILABLE",
  "PIXEL_POSITION_UNAVAILABLE",
  "TITLE_UNAVAILABLE",
  "SNIPPET_UNAVAILABLE"
] as const satisfies readonly NormalizedRankDataQualityFlag[];

const QUALITY_FLAG_INDEX = new Map<string, number>(
  QUALITY_FLAG_ORDER.map((flag, index) => [flag, index])
);

const FINAL_STATUSES: ReadonlySet<string> = new Set([
  "COMPLETED",
  "PARTIALLY_COMPLETED",
  "CANCELLED",
  "FAILED",
  "ACTION_REQUIRED"
] satisfies readonly RankCheckFinalStatus[]);

/**
 * Builds the one and only canonical normalized-result preimage.
 *
 * The builder requires the authoritative sealed chunk, checks exact tenant/
 * Job/chunk/hash identity and enforces a complete one-to-one result row for
 * every entry in manifest sequence order. It fails closed on extra keys so
 * raw provider data cannot sit outside the hashed allowlist.
 */
export function rankChunkIngestHashPreimage(
  command: InternalRankChunkIngestCommand,
  sealedChunk: InternalRankManifestChunk
): InternalRankChunkIngestHashPreimage {
  assertExactRecord(command, INGEST_COMMAND_KEYS);
  assertExactRecord(sealedChunk, MANIFEST_CHUNK_KEYS);
  assertUuidV7(command.workspaceId, "workspaceId");
  assertUuidV7(command.projectId, "projectId");
  assertUuidV7(command.actorId, "actorId");
  assertUuidV7(command.jobId, "jobId");
  assertUuidV7(command.jobItemId, "jobItemId");
  assertUuidV7(command.manifestId, "manifestId");
  assertHash(command.manifestChunkHash, "manifestChunkHash");
  assertChunkIndex(command.chunkIndex, command.provider);
  assertIsoInstant(command.observedAt, "observedAt");

  if (
    command.schemaVersion !== "rank-ingest@1" ||
    (command.provider !== "ARSENKIN" &&
      command.provider !== "XMLSTOCK") ||
    command.operation !== "POSITIONS" ||
    typeof command.providerRequestId !== "string" ||
    !PROVIDER_REQUEST_ID_PATTERN.test(command.providerRequestId) ||
    typeof command.connectorVersion !== "string" ||
    !CONNECTOR_VERSION_PATTERN.test(command.connectorVersion)
  ) {
    return invalidCanonicalRankResult("command");
  }

  assertUuidV7(sealedChunk.workspaceId, "sealedChunk.workspaceId");
  assertUuidV7(sealedChunk.projectId, "sealedChunk.projectId");
  assertUuidV7(sealedChunk.jobId, "sealedChunk.jobId");
  assertUuidV7(sealedChunk.manifestId, "sealedChunk.manifestId");
  assertHash(sealedChunk.chunkHash, "sealedChunk.chunkHash");
  assertChunkIndex(sealedChunk.chunkIndex, command.provider);
  if (
    sealedChunk.hashSchemaVersion !== "rank-manifest-chunk@1" ||
    command.workspaceId !== sealedChunk.workspaceId ||
    command.projectId !== sealedChunk.projectId ||
    command.jobId !== sealedChunk.jobId ||
    command.manifestId !== sealedChunk.manifestId ||
    command.chunkIndex !== sealedChunk.chunkIndex ||
    !sameHash(command.manifestChunkHash, sealedChunk.chunkHash) ||
    !Array.isArray(sealedChunk.entries) ||
    sealedChunk.entries.length < 1 ||
    sealedChunk.entries.length > rankManifestSingleTaskChunkSize ||
    (command.provider === "XMLSTOCK"
      ? sealedChunk.entries.length !== 1
      : false) ||
    !Array.isArray(command.results) ||
    command.results.length !== sealedChunk.entries.length
  ) {
    return invalidCanonicalRankResult("sealedChunk");
  }

  // The caller verifies the parent manifest and its immutable chunk hash.
  // Positive chunk indices identify legacy 250 or new 5000-entry strides;
  // chunk zero has the same sequence origin under every supported policy.
  const stride = command.provider === "XMLSTOCK" ? 1 : sealedChunk.chunkIndex === 0 ? rankManifestSingleTaskChunkSize : (sealedChunk.entries[0]?.sequence ?? -1) / sealedChunk.chunkIndex;
  if (command.provider === "ARSENKIN" && sealedChunk.chunkIndex > 0 && (
    ![legacyRankManifestChunkSize, batchedArsenkinRankChunkSize].includes(stride as typeof legacyRankManifestChunkSize) ||
    sealedChunk.entries.length > stride ||
    (stride === legacyRankManifestChunkSize && sealedChunk.chunkIndex > 3)
  )) return invalidCanonicalRankResult("sealedChunk");
  const expectedFirstSequence = sealedChunk.chunkIndex * stride;
  for (let index = 0; index < sealedChunk.entries.length; index += 1) {
    const entry = sealedChunk.entries[index];
    if (entry === undefined) {
      return invalidCanonicalRankResult("manifestEntry");
    }
    assertExactRecord(entry, MANIFEST_ENTRY_KEYS);
    assertUuidV7(entry.id, "manifestEntryId");
    assertUuidV7(entry.assignmentId, "assignmentId");
    assertUuidV7(entry.keywordId, "keywordId");
    assertHash(entry.keywordTextHash, "keywordTextHash");
    if (
      !Number.isSafeInteger(entry.sequence) ||
      entry.sequence !== expectedFirstSequence + index ||
      !Number.isSafeInteger(entry.keywordVersion) ||
      entry.keywordVersion < 1 ||
      !isBoundedKeywordText(entry.keywordText) ||
      entry.keywordTextHash.value !== utf8Sha256(entry.keywordText) ||
      !isCanonicalLanguage(entry.language)
    ) {
      return invalidCanonicalRankResult("manifestEntry");
    }
  }

  const expectedChunkHash = canonicalHash(
    "rank-manifest-chunk@1",
    rankManifestChunkHashPreimage(sealedChunk)
  );
  if (!sameHash(sealedChunk.chunkHash, expectedChunkHash)) {
    return invalidCanonicalRankResult("sealedChunk.chunkHash");
  }

  const results: InternalNormalizedRankResult[] = [];
  for (let index = 0; index < sealedChunk.entries.length; index += 1) {
    const entry = sealedChunk.entries[index];
    const result = command.results[index];
    if (entry === undefined || result === undefined) {
      return invalidCanonicalRankResult("results");
    }
    results.push(copyNormalizedResult(result, entry.id, entry.keywordId));
  }

  return {
    schemaVersion: "rank-ingest@1",
    workspaceId: command.workspaceId,
    projectId: command.projectId,
    actorId: command.actorId,
    jobId: command.jobId,
    jobItemId: command.jobItemId,
    manifestId: command.manifestId,
    chunkIndex: command.chunkIndex,
    manifestChunkHash: copyHash(command.manifestChunkHash),
    provider: command.provider,
    operation: command.operation,
    providerRequestId: command.providerRequestId,
    connectorVersion: command.connectorVersion,
    observedAt: command.observedAt,
    results
  };
}

export function rankChunkIngestHash(
  command: InternalRankChunkIngestCommand,
  sealedChunk: InternalRankManifestChunk
): RankManifestHash {
  return canonicalHash(
    "rank-ingest@1",
    rankChunkIngestHashPreimage(command, sealedChunk)
  );
}

/**
 * Builds the actor-independent finalize idempotency identity. Audit actor is
 * validated as trusted UUIDv7 but the first successful writer is stored in
 * the immutable receipt instead of changing replay identity.
 */
export function rankCheckFinalizationHashPreimage(
  input: InternalFinalizeRankCheckInput
): InternalRankCheckFinalizationHashPreimage {
  assertExactRecord(input, FINALIZATION_INPUT_KEYS);
  assertUuidV7(input.workspaceId, "workspaceId");
  assertUuidV7(input.projectId, "projectId");
  assertUuidV7(input.actorId, "actorId");
  assertUuidV7(input.jobId, "jobId");
  assertUuidV7(input.manifestId, "manifestId");
  if (
    input.schemaVersion !== "rank-finalize@1" ||
    !FINAL_STATUSES.has(input.status)
  ) {
    return invalidCanonicalRankResult("finalization");
  }
  return {
    schemaVersion: "rank-finalize@1",
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    jobId: input.jobId,
    manifestId: input.manifestId,
    status: input.status
  };
}

export function rankCheckFinalizationHash(
  input: InternalFinalizeRankCheckInput
): RankManifestHash {
  return canonicalHash(
    "rank-finalize@1",
    rankCheckFinalizationHashPreimage(input)
  );
}

/**
 * Builds the tenant-bound logical filter identity for a keyset cursor.
 * Cursor and limit are not part of the result set identity.
 */
export function rankHistoryFilterHashPreimage(
  query: InternalRankHistoryQuery
): InternalRankHistoryFilterHashPreimage {
  assertExactRecord(
    query,
    HISTORY_QUERY_REQUIRED_KEYS,
    HISTORY_QUERY_OPTIONAL_KEYS
  );
  assertUuidV7(query.workspaceId, "workspaceId");
  assertUuidV7(query.projectId, "projectId");
  assertUuidV7(query.actorId, "actorId");
  assertIsoInstant(query.observedFrom, "observedFrom");
  assertIsoInstant(query.observedBefore, "observedBefore");
  if (
    Date.parse(query.observedFrom) >= Date.parse(query.observedBefore) ||
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > 200 ||
    (query.cursor !== undefined &&
      (typeof query.cursor !== "string" ||
        query.cursor.length < 1 ||
        query.cursor.length > 4_096))
  ) {
    return invalidCanonicalRankResult("historyQuery");
  }
  if (query.trackingContextId !== undefined) {
    assertUuidV7(query.trackingContextId, "trackingContextId");
  }
  if (query.keywordId !== undefined) {
    assertUuidV7(query.keywordId, "keywordId");
  }
  if ((query.dimensionKey !== undefined && !parseSemanticRankDimensionKey(query.dimensionKey)) ||
    (query.mode !== undefined && query.mode !== "SERP") || (query.mode === "SERP" && query.limit > 10)) return invalidCanonicalRankResult("historyQuery");

  return {
    schemaVersion: "rank-history-filter@1",
    workspaceId: query.workspaceId,
    projectId: query.projectId,
    observedFrom: query.observedFrom,
    observedBefore: query.observedBefore,
    trackingContextId: query.trackingContextId ?? null,
    keywordId: query.keywordId ?? null,
    ...(query.dimensionKey === undefined ? {} : { dimensionKey: query.dimensionKey }),
    ...(query.mode === undefined ? {} : { mode: query.mode })
  };
}

export function rankHistoryFilterHash(
  query: InternalRankHistoryQuery
): RankManifestHash {
  return canonicalHash(
    "rank-history-filter@1",
    rankHistoryFilterHashPreimage(query)
  );
}

function copyNormalizedResult(
  input: InternalNormalizedRankResult,
  expectedEntryId: string,
  expectedKeywordId: string
): InternalNormalizedRankResult {
  if (
    input.manifestEntryId !== expectedEntryId ||
    input.keywordId !== expectedKeywordId
  ) {
    return invalidCanonicalRankResult("resultMembership");
  }
  assertUuidV7(input.manifestEntryId, "manifestEntryId");
  assertUuidV7(input.keywordId, "keywordId");
  const dataQualityFlags = sortedQualityFlags(input.dataQualityFlags);

  if (input.found === false) {
    assertExactRecord(
      input,
      NOT_FOUND_RESULT_KEYS,
      NOT_FOUND_RESULT_OPTIONAL_KEYS
    );
    if (
      input.position !== null ||
      dataQualityFlags.some(
        (flag) => flag !== "PROVIDER_OBSERVED_AT_UNAVAILABLE"
      )
    ) {
      return invalidCanonicalRankResult("notFoundResult");
    }
    const serpResults = copySerpResults(input.serpResults);
    return {
      manifestEntryId: input.manifestEntryId,
      keywordId: input.keywordId,
      dataQualityFlags,
      found: false,
      position: null,
      ...(serpResults === undefined ? {} : { serpResults })
    };
  }

  assertExactRecord(
    input,
    FOUND_RESULT_REQUIRED_KEYS,
    FOUND_RESULT_OPTIONAL_KEYS
  );
  if (
    input.found !== true ||
    !Number.isSafeInteger(input.position) ||
    input.position < 1 ||
    input.position > 100 ||
    input.resultType !== "ORGANIC" ||
    !Array.isArray(input.serpFeatures) ||
    input.serpFeatures.length !== 0
  ) {
    return invalidCanonicalRankResult("foundResult");
  }
  assertOptionalNonNegativeInteger(
    input.absolutePosition,
    "absolutePosition"
  );
  assertOptionalNonNegativeInteger(input.pixelPosition, "pixelPosition");
  assertUrl(input.rankingUrl, "rankingUrl");
  assertUrl(input.normalizedRankingUrl, "normalizedRankingUrl");
  assertOptionalBoundedString(input.title, MAX_TITLE_LENGTH, "title");
  assertOptionalBoundedString(input.snippet, MAX_SNIPPET_LENGTH, "snippet");
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
  const serpResults = copySerpResults(input.serpResults);

  return {
    manifestEntryId: input.manifestEntryId,
    keywordId: input.keywordId,
    dataQualityFlags,
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
    resultType: "ORGANIC",
    serpFeatures: [],
    ...(serpResults === undefined ? {} : { serpResults })
  };
}

function copySerpResults(
  value: readonly InternalNormalizedRankSerpResult[] | undefined
): readonly InternalNormalizedRankSerpResult[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > rankSerpResultMaxCount) {
    return invalidCanonicalRankResult("serpResults");
  }
  let previousPosition = 0;
  return value.map((entry) => {
    assertExactRecord(
      entry,
      SERP_RESULT_REQUIRED_KEYS,
      SERP_RESULT_OPTIONAL_KEYS
    );
    if (
      !Number.isSafeInteger(entry.position) ||
      entry.position < 1 ||
      entry.position > rankSerpResultMaxCount ||
      entry.position <= previousPosition
    ) {
      return invalidCanonicalRankResult("serpResult.position");
    }
    previousPosition = entry.position;
    assertUrl(entry.rankingUrl, "serpResult.rankingUrl");
    assertUrl(entry.normalizedRankingUrl, "serpResult.normalizedRankingUrl");
    if (entry.faviconUrl !== undefined) {
      assertUrl(entry.faviconUrl, "serpResult.faviconUrl");
    }
    assertOptionalBoundedString(entry.title, MAX_TITLE_LENGTH, "serpResult.title");
    assertOptionalBoundedString(
      entry.snippet,
      MAX_SNIPPET_LENGTH,
      "serpResult.snippet"
    );
    return {
      position: entry.position,
      rankingUrl: entry.rankingUrl,
      normalizedRankingUrl: entry.normalizedRankingUrl,
      ...(entry.faviconUrl === undefined
        ? {}
        : { faviconUrl: entry.faviconUrl }),
      ...(entry.title === undefined ? {} : { title: entry.title }),
      ...(entry.snippet === undefined ? {} : { snippet: entry.snippet })
    };
  });
}

function sortedQualityFlags(
  input: readonly NormalizedRankDataQualityFlag[]
): readonly NormalizedRankDataQualityFlag[] {
  if (!Array.isArray(input) || input.length > QUALITY_FLAG_ORDER.length) {
    return invalidCanonicalRankResult("dataQualityFlags");
  }
  const seen = new Set<string>();
  const flags: NormalizedRankDataQualityFlag[] = [];
  for (const flag of input) {
    if (!QUALITY_FLAG_INDEX.has(flag) || seen.has(flag)) {
      return invalidCanonicalRankResult("dataQualityFlags");
    }
    seen.add(flag);
    flags.push(flag);
  }
  return flags.sort(
    (left, right) =>
      (QUALITY_FLAG_INDEX.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (QUALITY_FLAG_INDEX.get(right) ?? Number.MAX_SAFE_INTEGER)
  );
}

function assertExactRecord(
  value: object,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): void {
  if (
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return invalidCanonicalRankResult("record");
  }

  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(value);
  if (
    requiredKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
    keys.some((key) => !allowed.has(key)) ||
    Object.getOwnPropertyNames(value).length !== keys.length ||
    Object.values(descriptors).some(
      (descriptor) =>
        !descriptor.enumerable || !Object.hasOwn(descriptor, "value")
    )
  ) {
    return invalidCanonicalRankResult("record");
  }
}

function assertUuidV7(value: string, field: string): void {
  if (typeof value !== "string" || !UUID_V7_PATTERN.test(value)) {
    return invalidCanonicalRankResult(field);
  }
}

function assertHash(value: RankManifestHash, field: string): void {
  assertExactRecord(value, ["algorithm", "value"]);
  if (
    value.algorithm !== "SHA_256" ||
    !HASH_PATTERN.test(value.value)
  ) {
    return invalidCanonicalRankResult(field);
  }
}

function sameHash(left: RankManifestHash, right: RankManifestHash): boolean {
  return (
    left.algorithm === right.algorithm && left.value === right.value
  );
}

function copyHash(value: RankManifestHash): RankManifestHash {
  return {
    algorithm: "SHA_256",
    value: value.value
  };
}

function assertChunkIndex(
  value: number,
  provider: InternalRankChunkIngestCommand["provider"]
): void {
  const maximum = provider === "XMLSTOCK"
    ? XMLSTOCK_RANK_CHUNK_MAX_INDEX
    : ARSENKIN_RANK_CHUNK_MAX_INDEX;
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    return invalidCanonicalRankResult("chunkIndex");
  }
}

function isBoundedKeywordText(value: string): boolean {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_KEYWORD_CODE_UNITS
  ) {
    return false;
  }
  let codePointCount = 0;
  for (const codePoint of value) {
    codePointCount += codePoint.length > 0 ? 1 : 0;
    if (codePointCount > MAX_KEYWORD_CODE_POINTS) {
      return false;
    }
  }
  return (
    new TextEncoder().encode(value).byteLength <= MAX_KEYWORD_UTF8_BYTES
  );
}

function isCanonicalLanguage(value: string): boolean {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_LANGUAGE_LENGTH
  ) {
    return false;
  }
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}

function assertIsoInstant(value: string, field: string): void {
  if (
    typeof value !== "string" ||
    value.length !== 24 ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    return invalidCanonicalRankResult(field);
  }
}

function assertOptionalNonNegativeInteger(
  value: number | undefined,
  field: string
): void {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) || value < 0)
  ) {
    return invalidCanonicalRankResult(field);
  }
}

function assertUrl(value: string, field: string): void {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_URL_LENGTH
  ) {
    return invalidCanonicalRankResult(field);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidCanonicalRankResult(field);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return invalidCanonicalRankResult(field);
  }
}

function assertOptionalBoundedString(
  value: string | undefined,
  maxLength: number,
  field: string
): void {
  if (
    value !== undefined &&
    (typeof value !== "string" ||
      value.length < 1 ||
      value.length > maxLength)
  ) {
    return invalidCanonicalRankResult(field);
  }
}

function assertAvailabilityFlag(
  flags: readonly NormalizedRankDataQualityFlag[],
  flag: NormalizedRankDataQualityFlag,
  expectedUnavailable: boolean
): void {
  if (flags.includes(flag) !== expectedUnavailable) {
    return invalidCanonicalRankResult("dataQualityFlags");
  }
}

function canonicalHash(domain: string, value: unknown): RankManifestHash {
  return {
    algorithm: "SHA_256",
    value: canonicalJsonSha256(domain, value)
  };
}

function invalidCanonicalRankResult(field: string): never {
  throw new TypeError(`Invalid canonical rank result field: ${field}`);
}
