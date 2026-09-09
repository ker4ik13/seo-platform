import { timingSafeEqual } from "node:crypto";
import type {
  InternalRankExecutionParameters,
  RankCollectionPurpose,
  TrackingContextConfigurationInput,
  TrackingDomainMatchRule
} from "@seo-platform/contracts";
import { canonicalJsonSha256 } from "@seo-platform/contracts/canonical-json";
import type { Prisma } from "../generated/prisma/client.js";

const EXECUTION_HASH_SCHEMA = "rank-estimate-execution@1";
export const ARSENKIN_RANK_MAPPING_VERSION = "arsenkin-positions@1" as const;
export const XMLSTOCK_RANK_MAPPING_VERSION = "xmlstock-serp@1" as const;
export const ARSENKIN_YANDEX_SEARCH_API_MAPPING_VERSION =
  "arsenkin-yandex-search-api@2" as const;
export const ARSENKIN_YANDEX_LIVE_MAPPING_VERSION =
  "arsenkin-yandex-live@2" as const;
export const ARSENKIN_GOOGLE_LIVE_MAPPING_VERSION =
  "arsenkin-google-live@2" as const;
export const ARSENKIN_CHECK_TOP_YANDEX_XML_MAPPING_VERSION =
  "arsenkin-check-top-yandex-xml@1" as const;
export const ARSENKIN_CHECK_TOP_YANDEX_LIVE_MAPPING_VERSION =
  "arsenkin-check-top-yandex-live@1" as const;
export const ARSENKIN_CHECK_TOP_GOOGLE_LIVE_MAPPING_VERSION =
  "arsenkin-check-top-google-live@1" as const;
export const XMLSTOCK_YANDEX_SEARCH_API_MAPPING_VERSION =
  "xmlstock-yandex-search-api@2" as const;
export const XMLSTOCK_YANDEX_LIVE_MAPPING_VERSION =
  "xmlstock-yandex-live@2" as const;
export const XMLSTOCK_YANDEX_LIVE_TURBO_MAPPING_VERSION =
  "xmlstock-yandex-live@3" as const;
export const XMLSTOCK_GOOGLE_LIVE_MAPPING_VERSION =
  "xmlstock-google-live@2" as const;
const SUPPORTED_MAPPING_VERSIONS = [
  ARSENKIN_RANK_MAPPING_VERSION,
  XMLSTOCK_RANK_MAPPING_VERSION,
  ARSENKIN_YANDEX_SEARCH_API_MAPPING_VERSION,
  ARSENKIN_YANDEX_LIVE_MAPPING_VERSION,
  ARSENKIN_GOOGLE_LIVE_MAPPING_VERSION,
  ARSENKIN_CHECK_TOP_YANDEX_XML_MAPPING_VERSION,
  ARSENKIN_CHECK_TOP_YANDEX_LIVE_MAPPING_VERSION,
  ARSENKIN_CHECK_TOP_GOOGLE_LIVE_MAPPING_VERSION,
  XMLSTOCK_YANDEX_SEARCH_API_MAPPING_VERSION,
  XMLSTOCK_YANDEX_LIVE_MAPPING_VERSION,
  XMLSTOCK_YANDEX_LIVE_TURBO_MAPPING_VERSION,
  XMLSTOCK_GOOGLE_LIVE_MAPPING_VERSION
] as const;
const REGION_ID_PATTERN = /^\d{1,10}$/u;
const SUPPORTED_SEARCH_ENGINES = ["GOOGLE", "YANDEX"] as const;
const SUPPORTED_DEPTHS = [10, 20, 30, 50, 100] as const;

export function rankEstimateExecutionParameters(
  configuration: TrackingContextConfigurationInput,
  provider: "ARSENKIN" | "XMLSTOCK" = "ARSENKIN",
  searchSource: "SEARCH_API" | "LIVE" =
    configuration.searchEngine === "GOOGLE" ? "LIVE" : "SEARCH_API",
  yandexLiveMode?: "TURBO",
  purpose: RankCollectionPurpose = "POSITION_TRACKING",
  saveProjectPosition?: boolean
): InternalRankExecutionParameters | undefined {
  if (
    !SUPPORTED_SEARCH_ENGINES.includes(configuration.searchEngine) ||
    !SUPPORTED_DEPTHS.includes(configuration.depth) ||
    (purpose !== "COMPETITOR_SERP" &&
      ![30, 50, 100].includes(configuration.depth)) ||
    (provider === "ARSENKIN" &&
      purpose !== "COMPETITOR_SERP" &&
      configuration.searchEngine === "YANDEX" &&
      configuration.depth !== 30) ||
    (configuration.searchEngine === "GOOGLE" &&
      searchSource !== "LIVE") ||
    (yandexLiveMode === "TURBO" &&
      (provider !== "XMLSTOCK" ||
        configuration.searchEngine !== "YANDEX" ||
        searchSource !== "LIVE")) ||
    !configuration.regionCode ||
    !REGION_ID_PATTERN.test(configuration.regionCode) ||
    configuration.safeSearch ||
    configuration.domainMatchRule.mode === "CANONICAL_DOMAIN" ||
    configuration.domainMatchRule.mode === "ANY_PROJECT_MIRROR"
  ) {
    return undefined;
  }
  return {
    ...(purpose === "COMPETITOR_SERP"
      ? {
          purpose,
          saveProjectPosition: saveProjectPosition ?? false
        }
      : {}),
    searchEngine: configuration.searchEngine,
    countryCode: configuration.countryCode,
    ...(configuration.regionCode
      ? { regionCode: configuration.regionCode }
      : {}),
    language: configuration.language,
    device: configuration.device,
    depth: configuration.depth,
    domainMatchRule: copyDomainMatchRule(
      configuration.domainMatchRule
    ),
    safeSearch: configuration.safeSearch,
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE",
    providerMappingVersion:
      providerMappingVersion(
        provider,
        configuration.searchEngine,
        searchSource,
        yandexLiveMode
      )
  };
}

export function rankEstimateExecutionHash(
  execution: InternalRankExecutionParameters
): Buffer {
  return Buffer.from(
    canonicalJsonSha256(EXECUTION_HASH_SCHEMA, execution),
    "hex"
  );
}

export function rankEstimateExecutionJson(
  execution: InternalRankExecutionParameters
): Prisma.InputJsonValue {
  return execution as unknown as Prisma.InputJsonValue;
}

export function storedRankEstimateExecution(
  value: unknown,
  storedHash: Uint8Array | null
): InternalRankExecutionParameters | undefined {
  if (value === null || storedHash === null) {
    if (value !== null || storedHash !== null) {
      invalid();
    }
    return undefined;
  }
  const execution = parseRankExecutionParameters(value);
  const actualHash = rankEstimateExecutionHash(execution);
  const expectedHash = Buffer.from(storedHash);
  if (
    expectedHash.length !== actualHash.length ||
    !timingSafeEqual(expectedHash, actualHash)
  ) {
    invalid();
  }
  return execution;
}

export function parseRankExecutionParameters(
  value: unknown
): InternalRankExecutionParameters {
  const input = exactRecord(value, [
    ...(hasField(value, "purpose") ? ["purpose"] : []),
    ...(hasField(value, "saveProjectPosition")
      ? ["saveProjectPosition"]
      : []),
    "searchEngine",
    "countryCode",
    ...(hasField(value, "regionCode") ? ["regionCode"] : []),
    "language",
    "device",
    "depth",
    "domainMatchRule",
    "safeSearch",
    "format",
    "rawSerp",
    "fallbackMode",
    "providerMappingVersion"
  ]);
  if (
    !SUPPORTED_SEARCH_ENGINES.includes(
      input.searchEngine as (typeof SUPPORTED_SEARCH_ENGINES)[number]
    ) ||
    (input.purpose !== undefined &&
      input.purpose !== "POSITION_TRACKING" &&
      input.purpose !== "COMPETITOR_SERP") ||
    (input.saveProjectPosition !== undefined &&
      typeof input.saveProjectPosition !== "boolean") ||
    typeof input.countryCode !== "string" ||
    !/^[A-Z]{2}$/u.test(input.countryCode) ||
    ("regionCode" in input &&
      (typeof input.regionCode !== "string" ||
        input.regionCode.length < 1 ||
        input.regionCode.length > 100 ||
        input.regionCode !== input.regionCode.trim())) ||
    !canonicalLanguage(input.language) ||
    !["DESKTOP", "MOBILE"].includes(String(input.device)) ||
    !SUPPORTED_DEPTHS.includes(
      input.depth as (typeof SUPPORTED_DEPTHS)[number]
    ) ||
    typeof input.safeSearch !== "boolean" ||
    input.format !== "SIMPLE" ||
    input.rawSerp !== false ||
    input.fallbackMode !== "NONE" ||
    !SUPPORTED_MAPPING_VERSIONS.includes(
      input.providerMappingVersion as (typeof SUPPORTED_MAPPING_VERSIONS)[number]
    )
  ) {
    invalid();
  }
  return {
    ...(input.purpose === undefined
      ? {}
      : { purpose: input.purpose as RankCollectionPurpose }),
    ...(input.saveProjectPosition === undefined
      ? {}
      : { saveProjectPosition: input.saveProjectPosition }),
    searchEngine:
      input.searchEngine as InternalRankExecutionParameters["searchEngine"],
    countryCode: input.countryCode,
    ...("regionCode" in input
      ? { regionCode: input.regionCode as string }
      : {}),
    language: input.language,
    device: input.device as InternalRankExecutionParameters["device"],
    depth: input.depth as InternalRankExecutionParameters["depth"],
    domainMatchRule: domainMatchRule(input.domainMatchRule),
    safeSearch: input.safeSearch,
    format: "SIMPLE",
    rawSerp: false,
    fallbackMode: "NONE",
    providerMappingVersion:
      input.providerMappingVersion as InternalRankExecutionParameters["providerMappingVersion"]
  };
}

function providerMappingVersion(
  provider: "ARSENKIN" | "XMLSTOCK",
  searchEngine: "GOOGLE" | "YANDEX",
  searchSource: "SEARCH_API" | "LIVE",
  yandexLiveMode: "TURBO" | undefined
): (typeof SUPPORTED_MAPPING_VERSIONS)[number] {
  if (provider === "ARSENKIN") {
    // Check Top returns the complete ordered SERP with snippets and is also
    // sufficient to derive the project position. New position estimates use
    // this mapping as well; persisted estimates with the older mapping remain
    // readable and continue through the legacy `positions` wire request.
    if (searchEngine === "GOOGLE") {
      return ARSENKIN_CHECK_TOP_GOOGLE_LIVE_MAPPING_VERSION;
    }
    return searchSource === "LIVE"
      ? ARSENKIN_CHECK_TOP_YANDEX_LIVE_MAPPING_VERSION
      : ARSENKIN_CHECK_TOP_YANDEX_XML_MAPPING_VERSION;
  }
  if (searchEngine === "GOOGLE") return XMLSTOCK_GOOGLE_LIVE_MAPPING_VERSION;
  if (searchSource === "LIVE" && yandexLiveMode === "TURBO") {
    return XMLSTOCK_YANDEX_LIVE_TURBO_MAPPING_VERSION;
  }
  return searchSource === "LIVE"
    ? XMLSTOCK_YANDEX_LIVE_MAPPING_VERSION
    : XMLSTOCK_YANDEX_SEARCH_API_MAPPING_VERSION;
}

function copyDomainMatchRule(
  value: TrackingDomainMatchRule
): TrackingDomainMatchRule {
  return "value" in value
    ? { mode: value.mode, value: value.value }
    : { mode: value.mode };
}

function domainMatchRule(value: unknown): TrackingDomainMatchRule {
  const input = record(value);
  if (
    input.mode === "SPECIFIC_URL" ||
    input.mode === "URL_PREFIX"
  ) {
    exactFields(input, ["mode", "value"]);
    if (
      typeof input.value !== "string" ||
      input.value.length < 1 ||
      input.value.length > 2_048 ||
      input.value !== input.value.trim()
    ) {
      invalid();
    }
    return { mode: input.mode, value: input.value };
  }
  exactFields(input, ["mode"]);
  if (
    ![
      "EXACT_HOST",
      "INCLUDE_WWW",
      "INCLUDE_SUBDOMAINS",
      "CANONICAL_DOMAIN",
      "ANY_PROJECT_MIRROR"
    ].includes(String(input.mode))
  ) {
    invalid();
  }
  return {
    mode: input.mode as Exclude<
      TrackingDomainMatchRule["mode"],
      "SPECIFIC_URL" | "URL_PREFIX"
    >
  };
}

function canonicalLanguage(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 16) return false;
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}

function hasField(value: unknown, field: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    field in value
  );
}

function exactRecord(
  value: unknown,
  fields: readonly string[]
): Readonly<Record<string, unknown>> {
  const input = record(value);
  exactFields(input, fields);
  return input;
}

function exactFields(
  input: Readonly<Record<string, unknown>>,
  fields: readonly string[]
): void {
  const allowed = new Set(fields);
  if (
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((field) => !allowed.has(field)) ||
    fields.some((field) => !(field in input))
  ) {
    invalid();
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

function invalid(): never {
  throw new Error("Invalid immutable rank estimate execution snapshot");
}
