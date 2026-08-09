import { BadRequestException } from "@nestjs/common";
import {
  normalizedRankDataQualityFlags,
  rankProviderKeywordLimit,
  type InternalIngestRankChunkInput,
  type InternalNormalizedRankResult,
  type InternalNormalizedRankSerpResult,
  type NormalizedRankDataQualityFlag,
  type RankManifestHash
} from "@seo-platform/contracts";
import { internalUuid } from "../internal/internal-command-context.js";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const CONNECTOR_VERSION_PATTERN =
  /^[a-z0-9][a-z0-9@._-]{0,63}$/u;
const PROVIDER_REQUEST_ID_PATTERN = /^[\x20-\x7e]{1,256}$/u;
const MAX_URL_LENGTH = 4_096;
const MAX_TITLE_LENGTH = 2_048;
const MAX_SNIPPET_LENGTH = 8_192;
const QUALITY_FLAGS = new Set<NormalizedRankDataQualityFlag>(
  normalizedRankDataQualityFlags
);

export function internalIngestRankChunkInput(
  value: unknown
): InternalIngestRankChunkInput {
  const input = strictRecord(value, [
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
    "results",
    "ingestEnvelopeHash"
  ]);
  if (
    input.schemaVersion !== "rank-ingest@1" ||
    (input.provider !== "ARSENKIN" && input.provider !== "XMLSTOCK") ||
    input.operation !== "POSITIONS"
  ) {
    invalid("contract");
  }
  if (
    typeof input.providerRequestId !== "string" ||
    !PROVIDER_REQUEST_ID_PATTERN.test(input.providerRequestId)
  ) {
    invalid("providerRequestId");
  }
  if (
    typeof input.connectorVersion !== "string" ||
    !CONNECTOR_VERSION_PATTERN.test(input.connectorVersion)
  ) {
    invalid("connectorVersion");
  }
  if (
    !Array.isArray(input.results) ||
    input.results.length < 1 ||
    input.results.length > rankProviderKeywordLimit
  ) {
    invalid("results");
  }
  return {
    schemaVersion: "rank-ingest@1",
    workspaceId: uuidV7(input.workspaceId, "workspaceId"),
    projectId: uuidV7(input.projectId, "projectId"),
    actorId: uuidV7(input.actorId, "actorId"),
    jobId: uuidV7(input.jobId, "jobId"),
    jobItemId: uuidV7(input.jobItemId, "jobItemId"),
    manifestId: uuidV7(input.manifestId, "manifestId"),
    chunkIndex: resultChunkIndex(input.chunkIndex),
    manifestChunkHash: rankHash(
      input.manifestChunkHash,
      "manifestChunkHash"
    ),
    provider: input.provider,
    operation: "POSITIONS",
    providerRequestId: input.providerRequestId,
    connectorVersion: input.connectorVersion,
    observedAt: isoInstant(input.observedAt, "observedAt"),
    results: input.results.map(normalizedResult),
    ingestEnvelopeHash: rankHash(
      input.ingestEnvelopeHash,
      "ingestEnvelopeHash"
    )
  };
}

export function resultChunkIndex(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^(?:0|[1-9]\d{0,3}|1[0-4]\d{3})$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 14_999) {
    invalid("chunkIndex");
  }
  return parsed;
}

function normalizedResult(
  value: unknown
): InternalNormalizedRankResult {
  const base = record(value, "result");
  if (base.found === false) {
    const input = strictRecord(value, [
      "manifestEntryId",
      "keywordId",
      "dataQualityFlags",
      "found",
      "position"
    ], ["serpResults"]);
    if (input.position !== null) invalid("result.position");
    const dataQualityFlags = qualityFlags(
      input.dataQualityFlags
    );
    if (
      dataQualityFlags.some(
        (flag) => flag !== "PROVIDER_OBSERVED_AT_UNAVAILABLE"
      )
    ) {
      invalid("result.dataQualityFlags");
    }
    const serpResults = normalizedSerpResults(input.serpResults);
    return {
      manifestEntryId: uuidV7(
        input.manifestEntryId,
        "result.manifestEntryId"
      ),
      keywordId: uuidV7(input.keywordId, "result.keywordId"),
      dataQualityFlags,
      found: false,
      position: null,
      ...(serpResults === undefined ? {} : { serpResults })
    };
  }

  const input = strictRecord(
    value,
    [
      "manifestEntryId",
      "keywordId",
      "dataQualityFlags",
      "found",
      "position",
      "rankingUrl",
      "normalizedRankingUrl",
      "resultType",
      "serpFeatures"
    ],
    ["absolutePosition", "pixelPosition", "title", "snippet", "serpResults"]
  );
  if (
    input.found !== true ||
    !Number.isSafeInteger(input.position) ||
    Number(input.position) < 1 ||
    Number(input.position) > 100 ||
    input.resultType !== "ORGANIC" ||
    !Array.isArray(input.serpFeatures) ||
    input.serpFeatures.length !== 0
  ) {
    invalid("result");
  }
  const dataQualityFlags = qualityFlags(input.dataQualityFlags);
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
  const serpResults = normalizedSerpResults(input.serpResults);
  return {
    manifestEntryId: uuidV7(
      input.manifestEntryId,
      "result.manifestEntryId"
    ),
    keywordId: uuidV7(input.keywordId, "result.keywordId"),
    dataQualityFlags,
    found: true,
    position: Number(input.position),
    ...optionalNonNegativeInteger(
      input.absolutePosition,
      "absolutePosition"
    ),
    ...optionalPixelPosition(input.pixelPosition),
    rankingUrl: httpUrl(input.rankingUrl, "result.rankingUrl"),
    normalizedRankingUrl: httpUrl(
      input.normalizedRankingUrl,
      "result.normalizedRankingUrl"
    ),
    ...optionalString(input.title, "title", MAX_TITLE_LENGTH),
    ...optionalSnippet(input.snippet),
    resultType: "ORGANIC",
    serpFeatures: [],
    ...(serpResults === undefined ? {} : { serpResults })
  };
}

function normalizedSerpResults(
  value: unknown
): readonly InternalNormalizedRankSerpResult[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 10) {
    invalid("result.serpResults");
  }
  return value.map((entry, index) => {
    const input = strictRecord(
      entry,
      ["position", "rankingUrl", "normalizedRankingUrl"],
      ["title", "snippet"]
    );
    if (!Number.isSafeInteger(input.position) || Number(input.position) !== index + 1) {
      invalid("result.serpResults.position");
    }
    return {
      position: Number(input.position),
      rankingUrl: httpUrl(input.rankingUrl, "result.serpResults.rankingUrl"),
      normalizedRankingUrl: httpUrl(
        input.normalizedRankingUrl,
        "result.serpResults.normalizedRankingUrl"
      ),
      ...optionalString(input.title, "title", MAX_TITLE_LENGTH),
      ...optionalSnippet(input.snippet)
    };
  });
}

function assertAvailabilityFlag(
  flags: readonly NormalizedRankDataQualityFlag[],
  flag: NormalizedRankDataQualityFlag,
  unavailable: boolean
): void {
  if (flags.includes(flag) !== unavailable) {
    invalid("result.dataQualityFlags");
  }
}

function optionalNonNegativeInteger(
  value: unknown,
  field: "absolutePosition"
): { readonly absolutePosition?: number } {
  if (value === undefined) return {};
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    invalid(`result.${field}`);
  }
  return { absolutePosition: Number(value) };
}

function optionalPixelPosition(
  value: unknown
): { readonly pixelPosition?: number } {
  if (value === undefined) return {};
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    invalid("result.pixelPosition");
  }
  return { pixelPosition: Number(value) };
}

function optionalString(
  value: unknown,
  field: "title",
  maxLength: number
): { readonly title?: string } {
  if (value === undefined) return {};
  if (typeof value !== "string" || value.length > maxLength) {
    invalid(`result.${field}`);
  }
  return { title: value };
}

function optionalSnippet(
  value: unknown
): { readonly snippet?: string } {
  if (value === undefined) return {};
  if (typeof value !== "string" || value.length > MAX_SNIPPET_LENGTH) {
    invalid("result.snippet");
  }
  return { snippet: value };
}

function qualityFlags(
  value: unknown
): readonly NormalizedRankDataQualityFlag[] {
  if (!Array.isArray(value) || value.length > QUALITY_FLAGS.size) {
    invalid("result.dataQualityFlags");
  }
  const flags: NormalizedRankDataQualityFlag[] = [];
  const seen = new Set<string>();
  for (const flag of value) {
    if (
      typeof flag !== "string" ||
      !QUALITY_FLAGS.has(flag as NormalizedRankDataQualityFlag) ||
      seen.has(flag)
    ) {
      invalid("result.dataQualityFlags");
    }
    seen.add(flag);
    flags.push(flag as NormalizedRankDataQualityFlag);
  }
  return flags;
}

function httpUrl(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_URL_LENGTH
  ) {
    invalid(field);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalid(field);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    invalid(field);
  }
  return value;
}

function rankHash(value: unknown, field: string): RankManifestHash {
  const input = strictRecord(value, ["algorithm", "value"]);
  if (
    input.algorithm !== "SHA_256" ||
    typeof input.value !== "string" ||
    !HASH_PATTERN.test(input.value)
  ) {
    invalid(field);
  }
  return { algorithm: "SHA_256", value: input.value };
}

function uuidV7(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field);
  const uuid = internalUuid(value, field);
  if (!UUID_V7_PATTERN.test(uuid)) invalid(field);
  return uuid;
}

function isoInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length !== 24) {
    invalid(field);
  }
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value
  ) {
    invalid(field);
  }
  return value;
}

function strictRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): Readonly<Record<string, unknown>> {
  const input = record(value, "body");
  const keys = Object.keys(input);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (
    requiredKeys.some((key) => !Object.hasOwn(input, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    invalid("body");
  }
  return input;
}

function record(
  value: unknown,
  field: string
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    invalid(field);
  }
  return value as Readonly<Record<string, unknown>>;
}

function invalid(field: string): never {
  throw new BadRequestException(
    `Invalid normalized rank result field: ${field}`
  );
}
